import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion } from '@/lib/consultas';
import type { Mensaje } from '@/types/database';

// Chat interno: cada operador tiene una conversación con la administración
// (mensajes con para_id = su id). para_id null = mensaje para todos.

export const LARGO_MAXIMO = 500;
const CANTIDAD = 200;
const REPASO_MS = 20000; // por si se corta el tiempo real

/** Mensajes de una conversación, del más viejo al más nuevo. operadorId null = los mensajes para todos. */
export async function traerConversacion(operadorId: string | null, conGenerales: boolean): Promise<Mensaje[]> {
  let q = supabase.from('mensajes').select('*');
  if (operadorId === null) q = q.is('para_id', null);
  else if (conGenerales) q = q.or(`para_id.eq.${operadorId},para_id.is.null`);
  else q = q.eq('para_id', operadorId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(CANTIDAD);
  if (error) throw error;
  return (data ?? []).reverse();
}

/** El admin escribe: se guarda y le llega como notificación al celular. */
export async function enviarComoAdmin(operadorId: string | null, texto: string): Promise<string> {
  const r = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { mensaje: texto, para_id: operadorId });
  return r.mensaje;
}

/** El operador escribe en su conversación. */
export async function enviarComoOperador(yo: string, texto: string): Promise<void> {
  const { error } = await supabase.from('mensajes').insert({ autor_id: yo, para_id: yo, texto });
  if (error) throw error;
}

export async function marcarLeidos(operadorId?: string): Promise<void> {
  await supabase.rpc('marcar_mensajes_leidos', operadorId ? { p_operador: operadorId } : {});
}

/** Cantidad de mensajes sin leer: para el admin, los que escribieron los operadores. */
export async function sinLeerAdmin(): Promise<number> {
  const { data, error } = await supabase.from('v_conversaciones').select('sin_leer');
  if (error) throw error;
  return (data ?? []).reduce((n, c) => n + c.sin_leer, 0);
}

/** Para el operador: los que le escribió la administración. */
export async function sinLeerOperador(yo: string): Promise<number> {
  const { count, error } = await supabase
    .from('mensajes')
    .select('id', { count: 'exact', head: true })
    .eq('para_id', yo)
    .is('leido_at', null)
    .or(`autor_id.is.null,autor_id.neq.${yo}`);
  if (error) throw error;
  return count ?? 0;
}

let canales = 0;

/** Llama a `fn` cuando llega o cambia un mensaje (tiempo real, y un repaso cada tanto). */
export function useMensajesEnVivo(fn: (m: Mensaje | null) => void, activo = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!activo) return;
    const canal = supabase
      .channel(`mensajes-${++canales}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes' }, (p) => ref.current(p.new as Mensaje))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensajes' }, () => ref.current(null))
      .subscribe();
    const t = setInterval(() => document.visibilityState === 'visible' && navigator.onLine && ref.current(null), REPASO_MS);
    const alVolver = () => document.visibilityState === 'visible' && ref.current(null);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
      void supabase.removeChannel(canal);
    };
  }, [activo]);
}
