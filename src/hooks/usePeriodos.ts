import { supabase } from '@/lib/supabase';
import type { Periodo } from '@/types/database';
import { useConsulta } from './useConsulta';

/** Todos los períodos, del más nuevo al más viejo. El activo (si hay) primero. */
export function usePeriodos() {
  return useConsulta(async () => {
    const { data, error } = await supabase
      .from('periodos')
      .select('*')
      .order('activo', { ascending: false })
      .order('fecha_inicio', { ascending: false });
    if (error) throw error;
    return data as Periodo[];
  }, []);
}
