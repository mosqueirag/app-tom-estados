import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado, Insignia, Tarjeta } from '@/components/ui';
import type { VRuta } from '@/types/database';
import { OrdenarRuta } from './rutas/OrdenarRuta';

type Mensaje = { tono: 'exito' | 'error'; texto: string };

const SIN_ASIGNAR = '';
const nombreRuta = (r: string) => r || 'Sin ruta';

export default function Rutas() {
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [ordenando, setOrdenando] = useState<string | null>(null);

  const rutas = useConsulta(async () => {
    const { data, error } = await supabase.from('v_rutas').select('*').order('ruta');
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

  async function asignar(r: VRuta, operadorId: string) {
    const nombre = operadores.datos?.find((o) => o.id === operadorId)?.nombre;
    const texto = operadorId
      ? `¿Asignar ${nombreRuta(r.ruta)} (${r.cuentas} cuentas) a ${nombre}?\n\nLe va a llegar un aviso al celular.`
      : `¿Dejar ${nombreRuta(r.ruta)} sin asignar?\n\nLa van a ver todos los operadores.`;
    if (!confirm(texto)) return;
    setGuardando(r.ruta);
    setMensaje(null);
    try {
      const res = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { ruta: r.ruta, operador_id: operadorId || null });
      setMensaje({ tono: 'exito', texto: res.mensaje });
      void rutas.recargar();
    } catch (e) {
      setMensaje({ tono: 'error', texto: (e as Error).message });
    } finally {
      setGuardando(null);
    }
  }

  const error = rutas.error ?? operadores.error;

  return (
    <div>
      <Encabezado titulo="Rutas" />
      <p className="mb-4 max-w-2xl text-sm text-slate-600">
        Elegí qué operador lee cada ruta. Cada operador descarga en su celular solo sus cuentas y las que no tienen operador.
        Cuando le asignás una ruta, le llega un aviso al celular (si activó los avisos). La ruta de cada cuenta se carga en{' '}
        <strong>Cuentas</strong> o desde el Excel (columna <code>ruta</code>).
      </p>

      {mensaje && (
        <Aviso tono={mensaje.tono} className="mb-4">
          {mensaje.texto}
        </Aviso>
      )}
      {error && <Aviso tono="error" className="mb-4">{error}</Aviso>}

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
                {rutas.datos?.map((r) => (
                  <tr key={r.ruta}>
                    <td className="font-medium">
                      {nombreRuta(r.ruta)} {r.repartida && <Insignia color="amarillo">Repartida</Insignia>}
                    </td>
                    <td className="text-right tabular-nums">{fmtNumero(r.cuentas)}</td>
                    <td className="text-right tabular-nums">{fmtNumero(r.pendientes)}</td>
                    <td>
                      <select
                        className="campo min-w-48"
                        aria-label={`Operador de ${nombreRuta(r.ruta)}`}
                        value={r.repartida ? 'repartida' : (r.operador_id ?? SIN_ASIGNAR)}
                        disabled={guardando !== null || !operadores.datos}
                        onChange={(e) => void asignar(r, e.target.value)}
                      >
                        {r.repartida && (
                          <option value="repartida" disabled>
                            Varios operadores
                          </option>
                        )}
                        <option value={SIN_ASIGNAR}>Sin asignar (la ven todos)</option>
                        {operadores.datos?.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nombre}
                          </option>
                        ))}
                      </select>
                      {guardando === r.ruta && <span className="ml-2 text-sm text-slate-500">Asignando…</span>}
                    </td>
                    <td className="text-right">
                      <button className="boton-chico whitespace-nowrap" onClick={() => setOrdenando(r.ruta)} aria-label={`Ordenar recorrido de ${nombreRuta(r.ruta)}`}>
                        Ordenar recorrido
                      </button>
                    </td>
                  </tr>
                ))}
                {rutas.datos?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Todavía no hay cuentas activas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
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
