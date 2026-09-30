import { createClient } from '@supabase/supabase-js';
import { config, configuracionCompleta } from './config';
import type { Database } from '@/types/database';
import { CLAVE_SESION } from './perfilLocal';

// Cliente con la clave PÚBLICA (anon/publishable). La seguridad la da la RLS.
// La clave service_role nunca se usa en el frontend.
export const supabase = createClient<Database>(
  config.supabaseUrl || 'http://localhost',
  config.supabaseAnonKey || 'sin-configurar',
  {
    auth: {
      persistSession: true, // la sesión queda guardada para trabajar offline
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: CLAVE_SESION,
    },
  },
);

export { configuracionCompleta };
