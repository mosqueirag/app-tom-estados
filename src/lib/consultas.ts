import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Trae todas las filas de una consulta, de a 1000 (el máximo por pedido de
 * Supabase). `armar(desde, hasta)` debe devolver la consulta con .range().
 */
export async function traerTodo<T>(armar: (desde: number, hasta: number) => Pagina<T>, tamanio = 1000): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += tamanio) {
    const { data, error } = await armar(desde, desde + tamanio - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < tamanio) return filas;
  }
}

/** Mensaje legible de un error de Supabase / PostgREST / Postgres. */
export function mensajeError(error: unknown): string {
  if (!error) return 'Error desconocido.';
  if (typeof error === 'string') return error;
  const e = error as { message?: string; details?: string; hint?: string; code?: string };
  if (e.code === '23505') return 'Ya existe un registro con ese dato (por ejemplo, el número de cuenta).';
  if (e.code === '42501') return e.message?.startsWith('new row') ? 'No tenés permiso para hacer esto.' : e.message ?? 'Sin permiso.';
  if (e.message && /failed to fetch|network|load failed/i.test(e.message)) {
    return 'No hay conexión con el servidor. Revisá internet y probá de nuevo.';
  }
  return [e.message, e.hint].filter(Boolean).join(' ') || 'Error desconocido.';
}

/** Llama a una Edge Function y devuelve su JSON, o lanza un Error con el mensaje en castellano. */
export async function llamarFuncion<T>(nombre: string, cuerpo: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(nombre, { body: cuerpo as Record<string, unknown> });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detalle = await error.context.json().catch(() => null);
      throw new Error(detalle?.error ?? 'La operación falló.');
    }
    throw new Error(mensajeError(error));
  }
  return data as T;
}
