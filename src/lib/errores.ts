import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

export function esErrorDeRed(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return true;
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/** Traduce los errores de Supabase Auth a mensajes claros en castellano. */
export function mensajeErrorLogin(error: unknown): string {
  if (esErrorDeRed(error)) {
    return 'No hay conexión. Para iniciar sesión por primera vez necesitás internet.';
  }
  if (isAuthApiError(error)) {
    const codigo = error.code ?? '';
    const texto = error.message.toLowerCase();
    if (codigo === 'invalid_credentials' || texto.includes('invalid login credentials')) {
      return 'Usuario o contraseña incorrectos.';
    }
    if (codigo === 'user_banned' || texto.includes('banned')) {
      return 'Tu usuario está desactivado. Consultá con el administrador.';
    }
    if (codigo === 'email_not_confirmed' || texto.includes('not confirmed')) {
      return 'El usuario todavía no fue confirmado. Consultá con el administrador.';
    }
    if (error.status === 429 || codigo === 'over_request_rate_limit') {
      return 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
    }
  }
  return 'No se pudo iniciar sesión. Probá de nuevo.';
}
