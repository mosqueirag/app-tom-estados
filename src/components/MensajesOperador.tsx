import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { supabase } from '@/lib/supabase';
import { db, type Meta } from '@/lib/db';
import { fmtFechaHora } from '@/lib/formato';
import { useConexion } from '@/hooks/useConexion';
import { useAuth } from '@/auth/contexto';
import { Link } from 'react-router';

const DIAS = 14;
const CLAVE_VISTO = 'mensajes-visto';

function leerVisto(operadorId: string): number {
  try {
    return Number(localStorage.getItem(`${CLAVE_VISTO}-${operadorId}`) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Trae los mensajes del admin y los deja guardados en el celular (para verlos sin señal). */
export async function actualizarMensajes(operadorId: string): Promise<void> {
  const desde = new Date(Date.now() - DIAS * 86400000).toISOString();
  const { data, error } = await supabase
    .from('mensajes')
    .select('id, texto, created_at, para_id')
    .gte('created_at', desde)
    .or(`autor_id.is.null,autor_id.neq.${operadorId}`) // los que escribió él van solo al chat
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  await db.meta.put({
    clave: 'mensajes',
    operador_id: operadorId,
    fecha: new Date().toISOString(),
    lista: (data ?? []).map((m) => ({ id: m.id, texto: m.texto, created_at: m.created_at, para_todos: m.para_id === null })),
  });
}

/** Mensajes del administrador en el Inicio del operador. Los nuevos se resaltan hasta tocar "Entendido". */
export function MensajesOperador({ resaltar = false }: { resaltar?: boolean }) {
  const enLinea = useConexion();
  const auth = useAuth();
  const operadorId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const guardado = useLiveQuery(() => db.meta.get('mensajes'), []) as Extract<Meta, { clave: 'mensajes' }> | undefined;
  const [visto, setVisto] = useState(() => leerVisto(operadorId));
  const [todos, setTodos] = useState(false);

  const traer = useCallback(() => {
    if (navigator.onLine && operadorId) void actualizarMensajes(operadorId).catch(() => {});
  }, [operadorId]);

  useEffect(() => {
    if (enLinea) traer();
  }, [enLinea, traer]);

  useEffect(() => {
    const alVolver = () => document.visibilityState === 'visible' && traer();
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [traer]);

  // En un celular compartido no se muestran los mensajes de otro operador
  const lista = guardado?.operador_id === operadorId ? guardado.lista : [];
  if (!lista.length) return null;
  const nuevos = lista.filter((m) => m.id > visto);
  const mostrar = todos ? lista : nuevos.length ? nuevos : lista.slice(0, 1);

  function entendido() {
    const ultimo = Math.max(...lista.map((m) => m.id));
    try {
      localStorage.setItem(`${CLAVE_VISTO}-${operadorId}`, String(ultimo));
    } catch {
      /* sin almacenamiento: se vuelve a mostrar la próxima vez */
    }
    setVisto(ultimo);
  }

  return (
    <section
      aria-label="Mensajes del administrador"
      className={`rounded-2xl p-4 shadow-sm ${nuevos.length ? 'bg-marca-50 ring-2 ring-marca-500' : 'bg-white'} ${resaltar ? 'scroll-mt-4' : ''}`}
      ref={(el) => {
        if (el && resaltar) el.scrollIntoView({ block: 'start' });
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{nuevos.length ? `Mensaje${nuevos.length === 1 ? '' : 's'} nuevo${nuevos.length === 1 ? '' : 's'} del administrador` : 'Último mensaje del administrador'}</p>
        {lista.length > 1 && (
          <button className="text-sm text-marca-700 underline" onClick={() => setTodos(!todos)}>
            {todos ? 'Ver menos' : 'Ver todos'}
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-2">
        {mostrar.map((m) => (
          <li key={m.id} className="rounded-xl bg-white/70 p-2">
            <p className="whitespace-pre-line">{m.texto}</p>
            <p className="text-xs text-slate-500">
              {fmtFechaHora(m.created_at)}
              {m.para_todos ? ' · para todos' : ' · para vos'}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        {nuevos.length > 0 && (
          <button className="boton-primario flex-1" onClick={entendido}>
            Entendido
          </button>
        )}
        <Link to="/operador/chat" className="boton-secundario flex-1">
          Responder
        </Link>
      </div>
    </section>
  );
}
