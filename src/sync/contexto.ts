import { createContext, useContext } from 'react';
import type { Meta } from '@/lib/db';
import type { ResultadoSync } from '@/lib/sincronizacion';

export type ValorSync = {
  pendientes: number;
  conflictos: number;
  rechazadas: number;
  sincronizando: boolean;
  descargando: boolean;
  ultimoResultado: ResultadoSync | null;
  estadoGuardado: Extract<Meta, { clave: 'sincronizacion' }> | undefined;
  descarga: Extract<Meta, { clave: 'descarga' }> | undefined;
  sincronizarAhora: () => Promise<ResultadoSync | null>;
  descargar: () => Promise<{ cantidad: number; periodo: string | null }>;
};

export const ContextoSync = createContext<ValorSync | null>(null);

export function useSync(): ValorSync {
  const v = useContext(ContextoSync);
  if (!v) throw new Error('useSync debe usarse dentro de <ProveedorSync>');
  return v;
}

/** iPhone / iPad (incluye iPadOS que se presenta como Mac). */
export function esIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}
