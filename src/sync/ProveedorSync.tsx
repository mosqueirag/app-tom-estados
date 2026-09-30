import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Meta } from '@/lib/db';
import { descargarCuentas, sincronizar, type ResultadoSync } from '@/lib/sincronizacion';
import { ContextoSync, type ValorSync } from './contexto';

// Cada cuánto se reintenta enviar mientras la app está abierta.
const INTERVALO_MS = 2 * 60 * 1000;

/**
 * Sincronización del operador. No depende de Background Sync (iPhone no lo
 * soporta): envía al abrir la app, al volver la señal (evento "online"), al
 * volver a la pantalla, cada 2 minutos mientras está abierta y con el botón.
 */
export function ProveedorSync({ operadorId, children }: { operadorId: string; children: ReactNode }) {
  const [sincronizando, setSincronizando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoSync | null>(null);
  const pendientesRef = useRef(0);

  const conteos = useLiveQuery(async () => {
    const [pendientes, conflictos, rechazadas] = await Promise.all([
      db.lecturas.where({ operador_id: operadorId, estado: 'pendiente' }).count(),
      db.lecturas.where({ operador_id: operadorId, estado: 'conflicto' }).count(),
      db.lecturas.where({ operador_id: operadorId, estado: 'rechazada' }).count(),
    ]);
    return { pendientes, conflictos, rechazadas };
  }, [operadorId]);
  const estadoGuardado = useLiveQuery(() => db.meta.get('sincronizacion'), []) as Extract<Meta, { clave: 'sincronizacion' }> | undefined;
  const descarga = useLiveQuery(() => db.meta.get('descarga'), []) as Extract<Meta, { clave: 'descarga' }> | undefined;
  pendientesRef.current = conteos?.pendientes ?? 0;

  const sincronizarAhora = useCallback(async () => {
    if (!navigator.onLine) {
      const r = { enviadas: 0, conflictos: 0, rechazadas: 0, error: 'Sin conexión. Las lecturas se envían cuando vuelva la señal.' };
      setUltimoResultado(r);
      return r;
    }
    setSincronizando(true);
    try {
      const r = await sincronizar(operadorId);
      setUltimoResultado(r);
      return r;
    } finally {
      setSincronizando(false);
    }
  }, [operadorId]);

  const descargar = useCallback(async () => {
    setDescargando(true);
    try {
      return await descargarCuentas(operadorId);
    } finally {
      setDescargando(false);
    }
  }, [operadorId]);

  useEffect(() => {
    const siHayPendientes = () => {
      if (pendientesRef.current > 0 && navigator.onLine) void sincronizarAhora();
    };
    void sincronizarAhora(); // al abrir la app
    const intervalo = setInterval(siHayPendientes, INTERVALO_MS);
    const alVolverSenal = () => void sincronizarAhora();
    const alVolverPantalla = () => document.visibilityState === 'visible' && siHayPendientes();
    window.addEventListener('online', alVolverSenal);
    document.addEventListener('visibilitychange', alVolverPantalla);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener('online', alVolverSenal);
      document.removeEventListener('visibilitychange', alVolverPantalla);
    };
  }, [sincronizarAhora]);

  const valor = useMemo<ValorSync>(
    () => ({
      pendientes: conteos?.pendientes ?? 0,
      conflictos: conteos?.conflictos ?? 0,
      rechazadas: conteos?.rechazadas ?? 0,
      sincronizando,
      descargando,
      ultimoResultado,
      estadoGuardado,
      descarga: descarga?.operador_id === operadorId ? descarga : undefined,
      sincronizarAhora,
      descargar,
    }),
    [conteos, sincronizando, descargando, ultimoResultado, estadoGuardado, descarga, operadorId, sincronizarAhora, descargar],
  );

  return <ContextoSync.Provider value={valor}>{children}</ContextoSync.Provider>;
}
