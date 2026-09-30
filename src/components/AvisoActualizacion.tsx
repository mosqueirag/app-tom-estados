import { useRegisterSW } from 'virtual:pwa-register/react';

// Revisa si hay una versión nueva de la app cada 30 minutos.
const REVISAR_CADA_MS = 30 * 60 * 1000;

/**
 * Registra el service worker (la app queda guardada en el celular y abre sin
 * señal) y avisa cuando hay una versión nueva, sin recargar sola.
 */
export function AvisoActualizacion() {
  const {
    needRefresh: [hayNueva, setHayNueva],
    offlineReady: [listaOffline, setListaOffline],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registro) {
      if (registro) setInterval(() => navigator.onLine && void registro.update(), REVISAR_CADA_MS);
    },
  });

  if (!hayNueva && !listaOffline) return null;

  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md rounded-2xl bg-slate-900 p-4 text-white shadow-xl md:bottom-4">
      {hayNueva ? (
        <>
          <p className="font-medium">Hay una versión nueva de la app.</p>
          <p className="text-sm text-slate-300">Tus lecturas guardadas no se pierden al actualizar.</p>
          <div className="mt-3 flex gap-2">
            <button className="rounded-lg bg-white px-4 py-2 font-semibold text-slate-900" onClick={() => void updateServiceWorker(true)}>
              Actualizar
            </button>
            <button className="rounded-lg px-4 py-2 text-slate-300" onClick={() => setHayNueva(false)}>
              Más tarde
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">La app ya quedó guardada: ahora abre aunque no haya señal.</p>
          <button className="rounded-lg px-3 py-1 text-sm text-slate-300" onClick={() => setListaOffline(false)}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}
