import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BellRing } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion, mensajeError, traerTodo } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Modal } from '@/components/ui';

type Grupo = { operadorId: string; nombre: string; numeros: string[] };
type Resultado = { tono: 'exito' | 'error' | 'alerta'; texto: string };

const MOSTRAR_NUMEROS = 25;
const LARGO_MAXIMO = 500;

/** Arma el texto del aviso: cuántas faltan y cuáles (hasta que entre en un mensaje). */
export function textoPendientes(nombre: string, periodo: string, numeros: string[], extra: string): string {
  const primero = nombre.split(/\s+/)[0] ?? '';
  const cabeza = `Hola ${primero}: te ${numeros.length === 1 ? 'queda 1 cuenta pendiente' : `quedan ${numeros.length} cuentas pendientes`} de ${periodo}.`;
  const cola = extra.trim() ? ` ${extra.trim()}` : '';
  let lista = numeros.slice(0, MOSTRAR_NUMEROS);
  const armar = () => `${cabeza} Cuentas: ${lista.join(', ')}${numeros.length > lista.length ? ` y ${numeros.length - lista.length} más` : ''}.${cola}`;
  while (armar().length > LARGO_MAXIMO && lista.length > 1) lista = lista.slice(0, -1);
  return armar().slice(0, LARGO_MAXIMO);
}

/** Manda a cada operador (notificación + chat) el aviso con sus cuentas sin leer. */
export function AvisarPendientes({ abierto, periodoId, periodoNombre, alCerrar }: { abierto: boolean; periodoId: string; periodoNombre: string; alCerrar: () => void }) {
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('Por favor, completalas lo antes posible.');
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);

  const datos = useConsulta(async () => {
    if (!abierto) return null;
    const [pendientes, { data: perfiles, error }] = await Promise.all([
      traerTodo<{ numero_cuenta: string; operador_id: string | null }>((d, h) =>
        supabase.rpc('cuentas_pendientes', { p_periodo_id: periodoId }).select('numero_cuenta, operador_id').order('numero_cuenta').range(d, h),
      ),
      supabase.from('perfiles').select('id, nombre, activo, rol').eq('rol', 'operador'),
    ]);
    if (error) throw error;
    const nombres = new Map((perfiles ?? []).filter((p) => p.activo).map((p) => [p.id, p.nombre]));
    const grupos = new Map<string, Grupo>();
    let sinOperador = 0;
    for (const c of pendientes) {
      const nombre = c.operador_id ? nombres.get(c.operador_id) : undefined;
      if (!c.operador_id || !nombre) {
        sinOperador++;
        continue;
      }
      const g = grupos.get(c.operador_id) ?? { operadorId: c.operador_id, nombre, numeros: [] };
      g.numeros.push(c.numero_cuenta);
      grupos.set(c.operador_id, g);
    }
    return { grupos: [...grupos.values()].sort((a, b) => b.numeros.length - a.numeros.length), sinOperador };
  }, [abierto, periodoId]);

  // Al abrir: todos elegidos y sin resultados viejos
  useEffect(() => {
    if (!abierto) return;
    setResultados([]);
    setElegidos(new Set(datos.datos?.grupos.map((g) => g.operadorId) ?? []));
  }, [abierto, datos.datos]);

  const grupos = datos.datos?.grupos ?? [];
  const aMandar = grupos.filter((g) => elegidos.has(g.operadorId));

  function alternar(id: string) {
    setElegidos((antes) => {
      const nuevos = new Set(antes);
      if (nuevos.has(id)) nuevos.delete(id);
      else nuevos.add(id);
      return nuevos;
    });
  }

  async function enviar() {
    setEnviando(true);
    const salida: Resultado[] = [];
    for (const g of aMandar) {
      try {
        const r = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', {
          mensaje: textoPendientes(g.nombre, periodoNombre, g.numeros, extra),
          para_id: g.operadorId,
        });
        salida.push({ tono: /no tiene|no están/.test(r.mensaje) ? 'alerta' : 'exito', texto: `${g.nombre}: ${r.mensaje}` });
      } catch (e) {
        salida.push({ tono: 'error', texto: `${g.nombre}: ${mensajeError(e)}` });
      }
    }
    setResultados(salida);
    setEnviando(false);
  }

  return (
    <Modal titulo="Avisar cuentas pendientes" abierto={abierto} alCerrar={alCerrar}>
      {datos.cargando && !datos.datos ? (
        <Cargando />
      ) : datos.error ? (
        <Aviso tono="error">{datos.error}</Aviso>
      ) : resultados.length ? (
        <div className="space-y-2">
          {resultados.map((r, i) => (
            <Aviso key={i} tono={r.tono}>
              {r.texto}
            </Aviso>
          ))}
          <p className="text-sm text-slate-600">El aviso también queda en el chat de cada operador.</p>
          <button className="boton-primario w-full" onClick={alCerrar}>
            Listo
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.length === 0 ? (
            <Aviso tono="exito">Ningún operador tiene cuentas pendientes.</Aviso>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                A cada operador le llega una notificación al celular y un mensaje en el chat con sus cuentas sin leer de {periodoNombre}.
              </p>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label="Operadores con pendientes">
                {grupos.map((g) => (
                  <li key={g.operadorId}>
                    <label className="flex cursor-pointer items-start gap-3 p-3">
                      <input type="checkbox" className="mt-1 size-5 accent-marca-600" checked={elegidos.has(g.operadorId)} onChange={() => alternar(g.operadorId)} />
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {g.nombre} · {fmtNumero(g.numeros.length)} {g.numeros.length === 1 ? 'pendiente' : 'pendientes'}
                        </span>
                        <span className="block truncate text-xs text-slate-500">{g.numeros.join(', ')}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <label className="block">
                <span className="etiqueta">Agregar al final (opcional)</span>
                <input className="campo" value={extra} maxLength={150} onChange={(e) => setExtra(e.target.value)} />
              </label>
              {aMandar[0] && (
                <div>
                  <p className="etiqueta">Así le llega a {aMandar[0].nombre}</p>
                  <p className="rounded-xl bg-slate-50 p-3 text-sm">{textoPendientes(aMandar[0].nombre, periodoNombre, aMandar[0].numeros, extra)}</p>
                </div>
              )}
            </>
          )}
          {datos.datos && datos.datos.sinOperador > 0 && (
            <Aviso tono="alerta">
              {fmtNumero(datos.datos.sinOperador)} {datos.datos.sinOperador === 1 ? 'cuenta pendiente no tiene' : 'cuentas pendientes no tienen'} operador.{' '}
              <Link to="/admin/rutas" className="font-medium underline" onClick={alCerrar}>
                Asignalas en Rutas
              </Link>
            </Aviso>
          )}
          {grupos.length > 0 && (
            <button className="boton-primario w-full" onClick={() => void enviar()} disabled={enviando || !aMandar.length}>
              <BellRing className="mr-2 size-5" aria-hidden="true" />
              {enviando ? 'Enviando…' : `Avisar a ${aMandar.length} ${aMandar.length === 1 ? 'operador' : 'operadores'}`}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
