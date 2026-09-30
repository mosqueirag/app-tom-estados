import { useEffect, useState } from 'react';
import { useSync } from '@/sync/contexto';
import { useConexion } from '@/hooks/useConexion';

type Bateria = EventTarget & { level: number; charging: boolean };
const LIMITE = 0.2;

/**
 * Aviso si queda poca batería y hay lecturas sin enviar, para que el operador
 * busque señal antes de que se apague el celular. Usa la Battery Status API,
 * que existe en Chrome de Android pero NO en iPhone (Safari no la tiene): ahí
 * simplemente no se muestra nada.
 */
export function AvisoBateria() {
  const sync = useSync();
  const enLinea = useConexion();
  const [bateria, setBateria] = useState<{ nivel: number; cargando: boolean } | null>(null);

  useEffect(() => {
    const obtener = (navigator as Navigator & { getBattery?: () => Promise<Bateria> }).getBattery;
    if (!obtener) return;
    let b: Bateria | null = null;
    const leer = () => b && setBateria({ nivel: b.level, cargando: b.charging });
    obtener
      .call(navigator)
      .then((x) => {
        b = x;
        leer();
        b.addEventListener('levelchange', leer);
        b.addEventListener('chargingchange', leer);
      })
      .catch(() => undefined);
    return () => {
      b?.removeEventListener('levelchange', leer);
      b?.removeEventListener('chargingchange', leer);
    };
  }, []);

  if (!bateria || bateria.cargando || bateria.nivel > LIMITE || sync.pendientes === 0) return null;

  return (
    <div role="alert" className="flex items-center gap-3 bg-red-50 px-4 py-2 text-sm text-red-900">
      <span className="text-xl" aria-hidden>
        🪫
      </span>
      <p className="flex-1">
        <strong>Batería baja ({Math.round(bateria.nivel * 100)}%)</strong> y tenés {sync.pendientes} lectura{sync.pendientes === 1 ? '' : 's'} sin enviar.{' '}
        {enLinea ? 'Envialas ahora.' : 'Buscá señal para enviarlas o cargá el celular.'} Si se apaga no se pierden, pero no llegan hasta que la prendas.
      </p>
      {enLinea && (
        <button className="boton-chico shrink-0" onClick={() => void sync.sincronizarAhora()} disabled={sync.sincronizando}>
          Enviar
        </button>
      )}
    </div>
  );
}
