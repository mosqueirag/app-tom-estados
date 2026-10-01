import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion, mensajeError } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado, Insignia, Tarjeta } from '@/components/ui';
import type { VRuta } from '@/types/database';
import { OrdenarRuta } from './rutas/OrdenarRuta';
import { ZonasRutas } from './rutas/ZonasRutas';

type Mensaje = { tono: 'exito' | 'error'; texto: string };

const SIN_ASIGNAR = '';
const nombreRuta = (r: string) => r || 'Sin ruta';

export default function Rutas() {
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [ordenando, setOrdenando] = useState<string | null>(null);
  // Cambios elegidos y todavía no guardados: ruta → operador ('' = sin operador)
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [nueva, setNueva] = useState('');

  const rutas = useConsulta(async () => {
    const { data, error } = await supabase.from('v_rutas').select('*').order('orden').order('ruta');
    if (error) throw error;
    return data;
  }, []);

  const operadores = useConsulta(async () => {
    const { data, error } = await supabase
      .from('perfiles')
      .select('id, nombre, rol')
      .eq('activo', true)
      .eq('rol', 'operador')
      .order('nombre');
    if (error) throw error;
    return data;
  }, []);

  const lista = rutas.datos ?? [];
  const actual = (r: VRuta) => r.operador_id ?? SIN_ASIGNAR;
  const elegido = (r: VRuta) => cambios[r.ruta] ?? actual(r);
  const pendientes = Object.keys(cambios).length;
  const nombreOperador = (id: string) => operadores.datos?.find((o) => o.id === id)?.nombre ?? '';

  function elegir(r: VRuta, operadorId: string) {
    setMensaje(null);
    setCambios((antes) => {
      const nuevos = { ...antes };
      if (operadorId === actual(r) && !r.repartida) delete nuevos[r.ruta];
      else nuevos[r.ruta] = operadorId;
      return nuevos;
    });
  }

  async function guardar() {
    if (!pendientes) return;
    // Un solo pedido (y un solo aviso) por operador; las cuentas sin ruta van aparte
    const grupos = new Map<string, { operadorId: string; rutas: string[] }>();
    for (const [ruta, op] of Object.entries(cambios)) {
      const clave = ruta === '' ? `sin-ruta:${op}` : op;
      const grupo = grupos.get(clave) ?? { operadorId: op, rutas: [] };
      grupo.rutas.push(ruta);
      grupos.set(clave, grupo);
    }
    setGuardando(true);
    setMensaje(null);
    const textos: string[] = [];
    const fallas: string[] = [];
    for (const grupo of grupos.values()) {
      try {
        const res = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { rutas: grupo.rutas, operador_id: grupo.operadorId || null });
        textos.push(res.mensaje);
        setCambios((antes) => {
          const nuevos = { ...antes };
          for (const r of grupo.rutas) delete nuevos[r];
          return nuevos;
        });
      } catch (e) {
        fallas.push(`${grupo.rutas.map(nombreRuta).join(', ')}: ${(e as Error).message}`);
      }
    }
    setGuardando(false);
    setMensaje(
      fallas.length
        ? { tono: 'error', texto: `No se pudo guardar ${fallas.join(' · ')}${textos.length ? ` (lo demás se guardó: ${textos.join(' ')})` : ''}` }
        : { tono: 'exito', texto: textos.join(' ') },
    );
    void rutas.recargar();
  }

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const nombre = nueva.trim().replace(/\s+/g, ' ');
    if (!nombre) return;
    if (lista.some((r) => r.ruta.toLowerCase() === nombre.toLowerCase())) {
      setMensaje({ tono: 'error', texto: `La ${nombre} ya existe.` });
      return;
    }
    const { error } = await supabase.from('rutas').insert({ nombre });
    if (error) setMensaje({ tono: 'error', texto: mensajeError(error) });
    else {
      setNueva('');
      setMensaje({ tono: 'exito', texto: `Se agregó la ${nombre}.` });
      void rutas.recargar();
    }
  }

  async function borrar(r: VRuta) {
    if (!confirm(`¿Borrar la ${r.ruta}? No tiene cuentas.`)) return;
    const { error } = await supabase.from('rutas').delete().eq('nombre', r.ruta);
    if (error) setMensaje({ tono: 'error', texto: mensajeError(error) });
    else {
      setCambios((antes) => {
        const nuevos = { ...antes };
        delete nuevos[r.ruta];
        return nuevos;
      });
      void rutas.recargar();
    }
  }

  const error = rutas.error ?? operadores.error;
  const conNombre = lista.filter((r) => r.ruta !== '');
  const sinOperador = conNombre.filter((r) => !elegido(r)).length;

  // Resumen: qué rutas quedan para cada operador (con lo elegido en pantalla)
  const resumen = (operadores.datos ?? []).map((o) => {
    const suyas = conNombre.filter((r) => elegido(r) === o.id);
    return { id: o.id, nombre: o.nombre, rutas: suyas.map((r) => r.ruta), cuentas: suyas.reduce((n, r) => n + r.cuentas, 0) };
  });

  return (
    <div className="pb-24">
      <Encabezado titulo="Rutas" />
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Elegí el operador de cada ruta y tocá <strong>Guardar cambios</strong>. Las cuentas de la ruta pasan a ese operador, le llega
        un aviso al celular y las cuentas nuevas que cargues en esa ruta le llegan solas. La ruta de cada cuenta se carga en{' '}
        <strong>Cuentas</strong> o desde el Excel (columna <code>ruta</code>).
      </p>

      {mensaje && (
        <Aviso tono={mensaje.tono} className="mb-4">
          {mensaje.texto}
        </Aviso>
      )}
      {error && <Aviso tono="error" className="mb-4">{error}</Aviso>}

      {resumen.length > 0 && (
        <Tarjeta className="mb-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Rutas por operador</h2>
            <p className="text-sm text-slate-600">
              {fmtNumero(conNombre.length)} rutas ·{' '}
              <span className={sinOperador ? 'font-medium text-amber-700' : ''}>{fmtNumero(sinOperador)} sin operador</span>
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Rutas por operador">
            {resumen.map((o) => (
              <li key={o.id} className="rounded-xl border border-slate-200 p-3">
                <p className="font-medium">
                  {o.nombre}{' '}
                  <span className="text-sm font-normal text-slate-500">
                    ({fmtNumero(o.rutas.length)} {o.rutas.length === 1 ? 'ruta' : 'rutas'} · {fmtNumero(o.cuentas)} cuentas)
                  </span>
                </p>
                <p className="mt-1 text-sm text-slate-600">{o.rutas.length ? o.rutas.join(', ') : 'Sin rutas'}</p>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {rutas.datos && <ZonasRutas rutas={rutas.datos} alCambiar={() => void rutas.recargar()} />}

      <Tarjeta className="p-0">
        {rutas.cargando && !rutas.datos ? (
          <Cargando />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Ruta</th>
                  <th className="text-right">Cuentas</th>
                  <th className="text-right">Pendientes del período</th>
                  <th>Operador</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => {
                  const cambiada = r.ruta in cambios;
                  return (
                    <tr key={r.ruta} className={cambiada ? 'bg-marca-50' : ''}>
                      <td className="font-medium">
                        {nombreRuta(r.ruta)} {r.tiene_zona && <Insignia color="verde">Zona</Insignia>} {r.repartida && !cambiada && <Insignia color="amarillo">Repartida</Insignia>}
                      </td>
                      <td className="text-right tabular-nums">{fmtNumero(r.cuentas)}</td>
                      <td className="text-right tabular-nums">{fmtNumero(r.pendientes)}</td>
                      <td>
                        <select
                          className="campo min-w-48"
                          aria-label={`Operador de ${nombreRuta(r.ruta)}`}
                          value={elegido(r)}
                          disabled={guardando || !operadores.datos}
                          onChange={(e) => elegir(r, e.target.value)}
                        >
                          <option value={SIN_ASIGNAR}>{r.ruta ? 'Sin operador (la ven todos)' : 'Sin asignar (la ven todos)'}</option>
                          {operadores.datos?.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.nombre}
                            </option>
                          ))}
                        </select>
                        {r.repartida && !cambiada && <span className="mt-1 block text-xs text-slate-500">Algunas cuentas están con otro operador</span>}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {r.cuentas > 0 ? (
                          <button className="boton-chico" onClick={() => setOrdenando(r.ruta)} aria-label={`Ordenar recorrido de ${nombreRuta(r.ruta)}`}>
                            Ordenar recorrido
                          </button>
                        ) : (
                          r.ruta &&
                          !elegido(r) && (
                            <button className="text-sm text-slate-500 hover:text-red-700 hover:underline" onClick={() => void borrar(r)} aria-label={`Borrar ${r.ruta}`}>
                              Borrar
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-4">
          <label>
            <span className="etiqueta">Agregar otra ruta</span>
            <input className="campo w-56" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="ej. Ruta 21" aria-label="Nombre de la ruta nueva" />
          </label>
          <button className="boton-secundario" disabled={!nueva.trim()}>
            Agregar
          </button>
        </form>
      </Tarjeta>

      {pendientes > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {pendientes === 1 ? '1 ruta cambiada' : `${pendientes} rutas cambiadas`}:{' '}
              <span className="text-slate-600">
                {Object.entries(cambios)
                  .map(([ruta, op]) => `${nombreRuta(ruta)} → ${op ? nombreOperador(op) : 'sin operador'}`)
                  .join(' · ')}
              </span>
            </p>
            <div className="flex gap-2">
              <button className="boton-secundario" onClick={() => setCambios({})} disabled={guardando}>
                Descartar
              </button>
              <button className="boton-primario" onClick={() => void guardar()} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      <OrdenarRuta
        ruta={ordenando}
        alCerrar={() => setOrdenando(null)}
        alGuardar={(texto) => {
          setOrdenando(null);
          setMensaje({ tono: 'exito', texto });
        }}
      />
    </div>
  );
}
