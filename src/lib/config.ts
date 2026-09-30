export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  dominioUsuarios: import.meta.env.VITE_DOMINIO_USUARIOS || 'usuarios.lecturas.app',
  /** Clave pública VAPID para los avisos push (la privada queda solo en Supabase). */
  vapidPublica: import.meta.env.VITE_VAPID_PUBLIC_KEY || '',
};

export const configuracionCompleta = Boolean(config.supabaseUrl && config.supabaseAnonKey);

/** "jperez" → "jperez@usuarios.lecturas.app"; un email se deja igual. */
export function usuarioAEmail(usuarioOEmail: string): string {
  const valor = usuarioOEmail.trim().toLowerCase();
  return valor.includes('@') ? valor : `${valor}@${config.dominioUsuarios}`;
}
