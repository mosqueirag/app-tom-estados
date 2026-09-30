import { useSyncExternalStore } from 'react';

function suscribir(avisar: () => void) {
  window.addEventListener('online', avisar);
  window.addEventListener('offline', avisar);
  return () => {
    window.removeEventListener('online', avisar);
    window.removeEventListener('offline', avisar);
  };
}

/** true si el navegador cree que hay conexión. */
export function useConexion(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => navigator.onLine,
    () => true,
  );
}
