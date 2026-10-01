/**
 * Busca las coordenadas de una dirección con OpenStreetMap (Nominatim).
 * Es gratis pero pide no más de una consulta por segundo: quien lo use tiene
 * que esperar entre llamadas (ver PAUSA_MS).
 */
export const PAUSA_MS = 1100;

export type Punto = { latitud: number; longitud: number };

export async function buscarDireccion(direccion: string, localidad: string, senal?: AbortSignal): Promise<Punto | null> {
  const texto = [direccion, localidad].map((t) => t.trim()).filter(Boolean).join(', ');
  if (!texto) return null;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', texto);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ar');
  url.searchParams.set('accept-language', 'es');
  const r = await fetch(url, { signal: senal, headers: { Accept: 'application/json' } });
  if (r.status === 429) throw new Error('El servicio de mapas pidió esperar. Probá de nuevo en unos minutos.');
  if (!r.ok) throw new Error(`El servicio de mapas respondió con error ${r.status}.`);
  const datos = (await r.json()) as { lat: string; lon: string }[];
  if (!datos.length) return null;
  const latitud = Number(datos[0].lat);
  const longitud = Number(datos[0].lon);
  return Number.isFinite(latitud) && Number.isFinite(longitud) ? { latitud, longitud } : null;
}

export const esperar = (ms: number, senal?: AbortSignal) =>
  new Promise<void>((resolver, rechazar) => {
    const t = setTimeout(resolver, ms);
    senal?.addEventListener('abort', () => {
      clearTimeout(t);
      rechazar(new DOMException('Cancelado', 'AbortError'));
    });
  });
