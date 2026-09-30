import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError, traerTodo } from '@/lib/consultas';
import { fmtFecha, fmtNumero } from '@/lib/formato';
import { descargarPlantillaCuentas, exportarCuentas } from '@/lib/excel';
import { useConsulta, useDemorado } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado, Insignia, Paginador, Tarjeta } from '@/components/ui';
import type { Cuenta } from '@/types/database';
import { FormularioCuenta } from './cuentas/FormularioCuenta';
import { ImportarCuentas } from './cuentas/ImportarCuentas';

const POR_PAGINA = 50;
type FiltroActiva = 'activas' | 'inactivas' | 'todas';
const TODAS_LAS_RUTAS = '*';

/** Quita caracteres que rompen el filtro .or() de PostgREST. */
export const limpiarBusqueda = (q: string) => q.replace(/[,()*%\\"]/g, ' ').trim();

export default function Cuentas() {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<FiltroActiva>('activas');
  const [ruta, setRuta] = useState(TODAS_LAS_RUTAS);
  const [pagina, setPagina] = useState(0);
  const [editando, setEditando] = useState<Cuenta | 'nueva' | null>(null);
  const [importando, setImportando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null);
  const q = limpiarBusqueda(useDemorado(busqueda));

  const periodoAbierto = useConsulta(async () => {
    const { data, error } = await supabase.from('periodos').select('id, nombre').eq('activo', true).maybeSingle();
    if (error) throw error;
    return data;
  }, []);

  const operadores = useConsulta(async () => {
    const { data, error } = await supabase.from('perfiles').select('id, nombre').eq('activo', true).eq('rol', 'operador').order('nombre');
    if (error) throw error;
    return data;
  }, []);

  const rutas = useConsulta(async () => {
    const { data, error } = await supabase.from('v_rutas').select('ruta, operador_id').order('ruta');
    if (error) throw error;
    return data;
  }, []);

  const nombreOperador = (id: string | null) =>
    id ? (operadores.datos?.find((o) => o.id === id)?.nombre ?? 'Operador desactivado') : '';

  const lista = useConsulta(async () => {
    let consulta = supabase.from('cuentas').select('*', { count: 'exact' });
    if (filtro !== 'todas') consulta = consulta.eq('activa', filtro === 'activas');
    if (ruta !== TODAS_LAS_RUTAS) consulta = consulta.eq('ruta', ruta);
    if (q) consulta = consulta.or(`numero_cuenta.ilike.%${q}%,titular.ilike.%${q}%,direccion.ilike.%${q}%,medidor.ilike.%${q}%`);
    const { data, error, count } = await consulta
      .order('numero_cuenta')
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (error) throw error;
    return { filas: data, total: count ?? 0 };
  }, [q, filtro, ruta, pagina]);

  async function cambiarActiva(c: Cuenta) {
    const accion = c.activa ? 'dar de baja' : 'reactivar';
    if (!confirm(`¿Querés ${accion} la cuenta ${c.numero_cuenta} (${c.titular})?`)) return;
    const { error } = await supabase.from('cuentas').update({ activa: !c.activa }).eq('id', c.id);
    if (error) setMensaje({ tono: 'error', texto: mensajeError(error) });
    else {
      setMensaje({ tono: 'exito', texto: `Cuenta ${c.numero_cuenta} ${c.activa ? 'dada de baja' : 'reactivada'}.` });
      void lista.recargar();
    }
  }

  async function exportar() {
    try {
      const todas = await traerTodo<Cuenta>((d, h) => supabase.from('cuentas').select('*').order('numero_cuenta').range(d, h));
      await exportarCuentas(todas);
    } catch (e) {
      setMensaje({ tono: 'error', texto: mensajeError(e) });
    }
  }

  return (
    <div>
      <Encabezado titulo="Cuentas">
        <button className="boton-chico" onClick={() => void descargarPlantillaCuentas()}>
          Descargar plantilla
        </button>
        <button className="boton-chico" onClick={() => void exportar()}>
          Exportar
        </button>
        <button className="boton-chico" onClick={() => setImportando(true)}>
          Importar Excel
        </button>
        <button className="boton-primario min-h-9 px-4 text-sm" onClick={() => setEditando('nueva')}>
          Nueva cuenta
        </button>
      </Encabezado>

      {mensaje && (
        <Aviso tono={mensaje.tono} className="mb-4">
          {mensaje.texto}
        </Aviso>
      )}

      <Tarjeta className="p-0">
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <input
            className="campo max-w-md flex-1"
            type="search"
            placeholder="Buscar por número, titular, dirección o medidor"
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
              setPagina(0);
            }}
          />
          <select
            className="campo w-auto"
            value={filtro}
            onChange={(e) => {
              setFiltro(e.target.value as FiltroActiva);
              setPagina(0);
            }}
            aria-label="Filtrar por estado"
          >
            <option value="activas">Activas</option>
            <option value="inactivas">Dadas de baja</option>
            <option value="todas">Todas</option>
          </select>
          <select
            className="campo w-auto"
            value={ruta}
            onChange={(e) => {
              setRuta(e.target.value);
              setPagina(0);
            }}
            aria-label="Filtrar por ruta"
          >
            <option value={TODAS_LAS_RUTAS}>Todas las rutas</option>
            {rutas.datos?.map(({ ruta: r }) => (
              <option key={r} value={r}>
                {r || 'Sin ruta'}
              </option>
            ))}
          </select>
        </div>

        {lista.error && <Aviso tono="error" className="m-4">{lista.error}</Aviso>}
        {lista.cargando && !lista.datos ? (
          <Cargando />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>N° cuenta</th>
                  <th>Titular</th>
                  <th>Dirección</th>
                  <th>Medidor</th>
                  <th>Ruta</th>
                  <th>Operador</th>
                  <th className="text-right">Última lectura</th>
                  <th className="text-right">Último consumo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.datos?.filas.map((c) => (
                  <tr key={c.id} className={c.activa ? '' : 'text-slate-400'}>
                    <td className="font-medium">
                      {c.numero_cuenta} {!c.activa && <Insignia>Baja</Insignia>}
                    </td>
                    <td>{c.titular}</td>
                    <td>{c.direccion}</td>
                    <td>{c.medidor}</td>
                    <td className="whitespace-nowrap">{c.ruta}</td>
                    <td className="whitespace-nowrap">{nombreOperador(c.operador_id) || <span className="text-slate-400">Sin asignar</span>}</td>
                    <td className="text-right tabular-nums">
                      {fmtNumero(c.ultima_lectura)}
                      <div className="text-xs text-slate-500">{fmtFecha(c.fecha_ultima_lectura)}</div>
                    </td>
                    <td className="text-right tabular-nums">{fmtNumero(c.ultimo_consumo)}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="boton-chico mr-2" onClick={() => setEditando(c)}>
                        Editar
                      </button>
                      <button className="boton-chico" onClick={() => void cambiarActiva(c)}>
                        {c.activa ? 'Dar de baja' : 'Reactivar'}
                      </button>
                    </td>
                  </tr>
                ))}
                {lista.datos?.filas.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      {q ? 'No hay cuentas que coincidan con la búsqueda.' : 'Todavía no hay cuentas. Importalas desde Excel o creá una nueva.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-4">
          <Paginador pagina={pagina} porPagina={POR_PAGINA} total={lista.datos?.total ?? 0} alCambiar={setPagina} />
        </div>
      </Tarjeta>

      <FormularioCuenta
        cuenta={editando}
        periodoAbierto={periodoAbierto.datos?.nombre ?? null}
        operadores={operadores.datos ?? []}
        rutas={rutas.datos ?? []}
        alCerrar={() => setEditando(null)}
        alGuardar={(texto) => {
          setEditando(null);
          setMensaje({ tono: 'exito', texto });
          void lista.recargar();
          void rutas.recargar();
        }}
      />
      <ImportarCuentas
        abierto={importando}
        periodoAbierto={periodoAbierto.datos?.nombre ?? null}
        alCerrar={() => {
          setImportando(false);
          void lista.recargar();
          void rutas.recargar();
        }}
      />
    </div>
  );
}
