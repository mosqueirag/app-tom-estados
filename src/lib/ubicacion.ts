export type Ubicacion = { latitud: number; longitud: number; precision: number };

/**
 * Pide la ubicación del celular. No bloquea: si no hay permiso, no hay GPS o
 * tarda más de `espera` ms, devuelve null y la lectura se guarda igual.
 */
export function obtenerUbicacion(espera = 15000): Promise<Ubicacion | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolver) => {
    const corte = setTimeout(() => resolver(null), espera + 1000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(corte);
        resolver({ latitud: p.coords.latitude, longitud: p.coords.longitude, precision: Math.round(p.coords.accuracy) });
      },
      () => {
        clearTimeout(corte);
        resolver(null);
      },
      { enableHighAccuracy: true, timeout: espera, maximumAge: 60_000 },
    );
  });
}

/** Link de Google Maps a un punto o a una dirección. */
export function linkMapa(destino: { latitud?: number | null; longitud?: number | null; direccion?: string; localidad?: string }): string {
  if (destino.latitud != null && destino.longitud != null) {
    return `https://www.google.com/maps/search/?api=1&query=${destino.latitud},${destino.longitud}`;
  }
  const texto = [destino.direccion, destino.localidad].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}`;
}
