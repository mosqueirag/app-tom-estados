import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { supabase } from '@/lib/supabase';
import { mensajeError, traerTodo } from '@/lib/consultas';
import { exportarLecturas } from '@/lib/excel';
import { useConsulta, useDemorado } from '@/hooks/useConsulta';
import { usePeriodos } from '@/hooks/usePeriodos';
import { Aviso, Cargando, Encabezado } from '@/components/ui';
import type { Cuenta, VLectura } from '@/types/database';
import { limpiarBusqueda } from './Cuentas';
import { TablaLecturas, type FiltrosLecturas, aplicarFiltros } from './lecturas/TablaLecturas';
import { TablaPendientes } from './lecturas/TablaPendientes';
import { TablaConflictos } from './lecturas/TablaConflictos';

type Vista = 'lecturas' | 'pendientes' | 'conflictos';

export default function Lecturas() {
  const [params, setParams] = useSearchParams();
  const periodos = usePeriodos();
  const [busqueda, setBusqueda] = useState(params.get('q') ?? '');
  const q = limpiarBusqueda(useDemorado(busqueda));
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vista = (params.get('vista') as Vista) || 'lecturas';
  const periodoId = params.get('periodo') ?? periodos.datos?.[0]?.id ?? '';
  const periodo = periodos.datos?.find((p) => p.id === periodoId);
  const filtros: FiltrosLecturas = {
    periodoId,
    operadorId: params.get('operador') ?? '',
    estado: (params.get('estado') as FiltrosLecturas['estado']) || 'todas',
    alerta: (params.get('alerta') as FiltrosLecturas['alerta']) || 'todas',
    q,
  };

  const operadores = useConsulta(async () => {
    const { data, error } = await supabase.from('perfiles').select('id, nombre').order('nombre');
    if (error) throw error;
    return data;
  }, []);

  function cambiar(clave: string, valor: string) {
    const nuevos = new URLSearchParams(params);
    if (valor) nuevos.set(clave, valor);
    else nuevos.delete(clave);
    setParams(nuevos, { replace: true });
  }

  useEffect(() => setError(null), [vista]);

  async function exportar() {
    if (!periodo) return;
    setExportando(true);
    setError(null);
    try {
      const lecturas = await traerTodo<VLectura>((d, h) =>
        aplicarFiltros(supabase.from('v_lecturas').select('*'), filtros).order('numero_cuenta').range(d, h),
      );
      const sinFiltros = !filtros.operadorId && filtros.estado === 'todas' && filtros.alerta === 'todas' && !filtros.q;
      const pendientes = sinFiltros
        ? await traerTodo<Cuenta>((d, h) => supabase.rpc('cuentas_pendientes', { p_periodo_id: periodo.id }).range(d, h))
        : [];
      const nombre = `lecturas_${periodo.nombre.toLowerCase().replace(/\s+/g, '_')}.xlsx`;
      await exportarLecturas(nombre, lecturas, pendientes);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setExportando(false);
    }
  }

  if (periodos.cargando && !periodos.datos) return <Cargando />;
  if (periodos.error) return <Aviso tono="error">{periodos.error}</Aviso>;
  if (!periodos.datos?.length) return <Aviso>Todavía no hay períodos. Abrí uno en la sección Períodos.</Aviso>;

  return (
    <div>
      <Encabezado titulo="Lecturas">
        <button className="boton-primario min-h-9 px-4 text-sm" onClick={() => void exportar()} disabled={exportando || !periodo}>
          {exportando ? 'Exportando…' : 'Exportar a Excel'}
        </button>
      </Encabezado>

      <div className="mb-4 flex flex-wrap gap-3">
        <select className="campo w-auto" value={periodoId} onChange={(e) => cambiar('periodo', e.target.value)} aria-label="Período">
          {periodos.datos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} {p.activo ? '(activo)' : '(cerrado)'}
            </option>
          ))}
        </select>
        <div className="flex rounded-xl border border-slate-300 bg-white p-1">
          {(['lecturas', 'pendientes', 'conflictos'] as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => cambiar('vista', v === 'lecturas' ? '' : v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${vista === v ? 'bg-marca-600 text-white' : 'text-slate-700'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && <Aviso tono="error" className="mb-4">{error}</Aviso>}

      {vista === 'lecturas' && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <input
              className="campo max-w-xs"
              type="search"
              placeholder="Buscar cuenta o titular"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <select className="campo w-auto" value={filtros.operadorId} onChange={(e) => cambiar('operador', e.target.value)} aria-label="Operador">
              <option value="">Todos los operadores</option>
              {operadores.datos?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
            <select className="campo w-auto" value={filtros.estado} onChange={(e) => cambiar('estado', e.target.value === 'todas' ? '' : e.target.value)} aria-label="Estado">
              <option value="todas">Todos los estados</option>
              <option value="con_lectura">Con lectura</option>
              <option value="sin_lectura">Sin lectura</option>
              <option value="corregidas">Corregidas</option>
            </select>
            <select className="campo w-auto" value={filtros.alerta} onChange={(e) => cambiar('alerta', e.target.value === 'todas' ? '' : e.target.value)} aria-label="Alertas">
              <option value="todas">Con y sin alertas</option>
              <option value="cualquiera">Cualquier alerta</option>
              <option value="menor_anterior">Menor a la anterior</option>
              <option value="consumo_anomalo">Consumo anómalo</option>
              <option value="sin_lectura">Sin lectura</option>
            </select>
          </div>
          <TablaLecturas filtros={filtros} periodoActivo={Boolean(periodo?.activo)} />
        </>
      )}
      {vista === 'pendientes' && periodo && <TablaPendientes periodoId={periodo.id} />}
      {vista === 'conflictos' && periodo && <TablaConflictos periodoId={periodo.id} periodoActivo={periodo.activo} />}
    </div>
  );
}
