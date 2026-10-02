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
import {
  TablaLecturas,
  type ColumnaOrden,
  type FiltrosLecturas,
  type Orden,
  COLUMNAS_ORDEN,
  ORDEN_INICIAL,
  SIN_RUTA,
  aplicarFiltros,
  aplicarOrden,
} from './lecturas/TablaLecturas';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, FileSpreadsheet, FilterX } from 'lucide-react';
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
    ruta: params.get('ruta') ?? '',
    desde: params.get('desde') ?? '',
    hasta: params.get('hasta') ?? '',
    consumoMin: params.get('cmin') ?? '',
    consumoMax: params.get('cmax') ?? '',
  };
  const columna = params.get('orden') as ColumnaOrden | null;
  const orden: Orden =
    columna && columna in COLUMNAS_ORDEN ? { columna, asc: params.get('dir') !== 'desc' } : ORDEN_INICIAL;
  const hayFiltros = Boolean(
    busqueda || filtros.operadorId || filtros.ruta || filtros.desde || filtros.hasta || filtros.consumoMin || filtros.consumoMax ||
      filtros.estado !== 'todas' || filtros.alerta !== 'todas',
  );

  const rutas = useConsulta(async () => {
    const { data, error } = await supabase.from('v_rutas').select('ruta, orden').order('orden').order('ruta');
    if (error) throw error;
    return data;
  }, []);

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

  function ordenar(o: Orden) {
    const nuevos = new URLSearchParams(params);
    if (o.columna === ORDEN_INICIAL.columna && o.asc === ORDEN_INICIAL.asc) {
      nuevos.delete('orden');
      nuevos.delete('dir');
    } else {
      nuevos.set('orden', o.columna);
      nuevos.set('dir', o.asc ? 'asc' : 'desc');
    }
    setParams(nuevos, { replace: true });
  }

  function limpiarFiltros() {
    const nuevos = new URLSearchParams();
    for (const clave of ['periodo', 'vista', 'orden', 'dir']) {
      const v = params.get(clave);
      if (v) nuevos.set(clave, v);
    }
    setBusqueda('');
    setParams(nuevos, { replace: true });
  }

  useEffect(() => setError(null), [vista]);

  async function exportar() {
    if (!periodo) return;
    setExportando(true);
    setError(null);
    try {
      const lecturas = await traerTodo<VLectura>((d, h) =>
        aplicarOrden(aplicarFiltros(supabase.from('v_lecturas').select('*'), filtros), columna ? orden : { columna: 'numero_cuenta', asc: true }).range(d, h),
      );
      const sinFiltros =
        !filtros.operadorId && filtros.estado === 'todas' && filtros.alerta === 'todas' && !filtros.q &&
        !filtros.ruta && !filtros.desde && !filtros.hasta && !filtros.consumoMin && !filtros.consumoMax;
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
          <FileSpreadsheet className="mr-1.5 size-4" aria-hidden="true" />
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
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${vista === v ? 'fondo-marca shadow-sm' : 'text-slate-700'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && <Aviso tono="error" className="mb-4">{error}</Aviso>}

      {vista === 'lecturas' && (
        <>
          <section className="mb-4 rounded-2xl border border-marca-100 bg-white p-4 shadow-sm" aria-label="Filtros de lecturas">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="sm:col-span-2">
                <span className="etiqueta">Buscar</span>
                <input
                  className="campo"
                  type="search"
                  placeholder="Buscar cuenta o titular"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
              </label>
              <label>
                <span className="etiqueta">Operador</span>
                <select className="campo" value={filtros.operadorId} onChange={(e) => cambiar('operador', e.target.value)} aria-label="Operador">
                  <option value="">Todos los operadores</option>
                  {operadores.datos?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">Ruta</span>
                <select className="campo" value={filtros.ruta} onChange={(e) => cambiar('ruta', e.target.value)} aria-label="Ruta">
                  <option value="">Todas las rutas</option>
                  {rutas.datos?.map((r) => (
                    <option key={r.ruta || SIN_RUTA} value={r.ruta || SIN_RUTA}>
                      {r.ruta || 'Sin ruta'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="etiqueta">Estado</span>
                <select className="campo" value={filtros.estado} onChange={(e) => cambiar('estado', e.target.value === 'todas' ? '' : e.target.value)} aria-label="Estado">
                  <option value="todas">Todos los estados</option>
                  <option value="con_lectura">Con lectura</option>
                  <option value="sin_lectura">Sin lectura</option>
                  <option value="corregidas">Corregidas</option>
                </select>
              </label>
              <label>
                <span className="etiqueta">Alertas</span>
                <select className="campo" value={filtros.alerta} onChange={(e) => cambiar('alerta', e.target.value === 'todas' ? '' : e.target.value)} aria-label="Alertas">
                  <option value="todas">Con y sin alertas</option>
                  <option value="cualquiera">Cualquier alerta</option>
                  <option value="menor_anterior">Menor a la anterior</option>
                  <option value="consumo_anomalo">Consumo anómalo</option>
                  <option value="sin_lectura">Sin lectura</option>
                </select>
              </label>
              <label>
                <span className="etiqueta">Desde</span>
                <input className="campo" type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => cambiar('desde', e.target.value)} aria-label="Fecha desde" />
              </label>
              <label>
                <span className="etiqueta">Hasta</span>
                <input className="campo" type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => cambiar('hasta', e.target.value)} aria-label="Fecha hasta" />
              </label>
              <label>
                <span className="etiqueta">Consumo mínimo</span>
                <input className="campo" inputMode="numeric" value={filtros.consumoMin} onChange={(e) => cambiar('cmin', e.target.value)} placeholder="ej. 0" aria-label="Consumo mínimo" />
              </label>
              <label>
                <span className="etiqueta">Consumo máximo</span>
                <input className="campo" inputMode="numeric" value={filtros.consumoMax} onChange={(e) => cambiar('cmax', e.target.value)} placeholder="ej. 500" aria-label="Consumo máximo" />
              </label>
              <div>
                <span className="etiqueta">Ordenar por</span>
                <div className="flex gap-2">
                  <select
                    className="campo"
                    value={orden.columna}
                    onChange={(e) => ordenar({ columna: e.target.value as ColumnaOrden, asc: e.target.value !== 'fecha_lectura' })}
                    aria-label="Ordenar por"
                  >
                    {(Object.keys(COLUMNAS_ORDEN) as ColumnaOrden[]).map((c) => (
                      <option key={c} value={c}>
                        {COLUMNAS_ORDEN[c]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="boton-secundario shrink-0 px-3"
                    onClick={() => ordenar({ ...orden, asc: !orden.asc })}
                    aria-label={orden.asc ? 'Orden ascendente (de menor a mayor, A a Z). Tocá para invertir' : 'Orden descendente (de mayor a menor, Z a A). Tocá para invertir'}
                    title={orden.asc ? 'De menor a mayor (A → Z)' : 'De mayor a menor (Z → A)'}
                  >
                    {orden.asc ? <ArrowUpNarrowWide className="size-5" aria-hidden="true" /> : <ArrowDownWideNarrow className="size-5" aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>
            {hayFiltros && (
              <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-marca-700 hover:underline" onClick={limpiarFiltros}>
                <FilterX className="size-4" aria-hidden="true" />
                Limpiar filtros
              </button>
            )}
          </section>
          <TablaLecturas filtros={filtros} periodoActivo={Boolean(periodo?.activo)} orden={orden} alOrdenar={ordenar} />
        </>
      )}
      {vista === 'pendientes' && periodo && <TablaPendientes periodoId={periodo.id} />}
      {vista === 'conflictos' && periodo && <TablaConflictos periodoId={periodo.id} periodoActivo={periodo.activo} />}
    </div>
  );
}
