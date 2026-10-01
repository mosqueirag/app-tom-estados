import type { Zona } from '@/types/database';

/** Una zona leída del KML: el nombre del lugar (Placemark) y sus polígonos. */
export type ZonaKml = { nombre: string; carpeta: string; zona: Zona };

/** Lee un archivo .kml o .kmz (Google Earth / Google My Maps) y devuelve sus polígonos. */
export async function leerArchivoZonas(archivo: File): Promise<ZonaKml[]> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const esZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": es un KMZ
  const texto = esZip ? await kmlDentroDeKmz(bytes) : new TextDecoder().decode(bytes);
  return leerKml(texto);
}

export function leerKml(texto: string): ZonaKml[] {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un KML válido.');

  const zonas: ZonaKml[] = [];
  for (const lugar of Array.from(doc.getElementsByTagNameNS('*', 'Placemark'))) {
    const poligonos: Zona = [];
    for (const pol of Array.from(lugar.getElementsByTagNameNS('*', 'Polygon'))) {
      const borde = anillo(pol, 'outerBoundaryIs')[0];
      if (!borde) continue;
      poligonos.push([borde, ...anillo(pol, 'innerBoundaryIs')]);
    }
    if (!poligonos.length) continue; // puntos o líneas: no son zonas
    zonas.push({ nombre: textoHijo(lugar, 'name'), carpeta: nombreCarpeta(lugar), zona: poligonos });
  }
  if (!zonas.length) throw new Error('El archivo no tiene zonas (polígonos). Dibujá cada ruta como un polígono en Google My Maps o Google Earth.');
  return zonas;
}

function textoHijo(el: Element, etiqueta: string): string {
  for (const hijo of Array.from(el.children)) if (hijo.localName === etiqueta) return (hijo.textContent ?? '').trim();
  return '';
}

function nombreCarpeta(el: Element): string {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.localName === 'Folder') return textoHijo(p, 'name');
  }
  return '';
}

function anillo(poligono: Element, borde: 'outerBoundaryIs' | 'innerBoundaryIs'): [number, number][][] {
  const anillos: [number, number][][] = [];
  for (const b of Array.from(poligono.getElementsByTagNameNS('*', borde))) {
    const coords = b.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '';
    const puntos = coords
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number))
      .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6] as [number, number]);
    if (puntos.length >= 3) anillos.push(puntos);
  }
  return anillos;
}

/**
 * Nombre de ruta sugerido para un lugar del KML: si el nombre (o su carpeta)
 * tiene un número, "Ruta N"; si no, el nombre tal cual.
 */
export function rutaSugerida(z: ZonaKml, existentes: string[]): string {
  for (const candidato of [z.nombre, z.carpeta]) {
    if (!candidato) continue;
    const igual = existentes.find((r) => r.toLowerCase() === candidato.toLowerCase());
    if (igual) return igual;
    const n = candidato.match(/(\d+)/)?.[1];
    if (n) return `Ruta ${Number(n)}`;
  }
  return z.nombre || z.carpeta;
}

/** ¿El punto está dentro de la zona? (mismo cálculo que la base de datos) */
export function puntoEnZona(lat: number, lng: number, zona: Zona): boolean {
  const enAnillo = (a: [number, number][]) => {
    let dentro = false;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const [xi, yi] = a[i];
      const [xj, yj] = a[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  };
  return zona.some((pol) => enAnillo(pol[0]) && !pol.slice(1).some(enAnillo));
}

// ------------------------------------------------------------------ KMZ
// Un KMZ es un ZIP con un doc.kml adentro. Se lee con el descompresor del navegador.
async function kmlDentroDeKmz(zip: Uint8Array): Promise<string> {
  const vista = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Fin del directorio central
  let fin = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (vista.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('El KMZ está dañado.');
  const total = vista.getUint16(fin + 10, true);
  let p = vista.getUint32(fin + 16, true);
  const entradas: { nombre: string; metodo: number; comprimido: number; local: number }[] = [];
  for (let k = 0; k < total; k++) {
    if (vista.getUint32(p, true) !== 0x02014b50) break;
    const metodo = vista.getUint16(p + 10, true);
    const comprimido = vista.getUint32(p + 20, true);
    const largoNombre = vista.getUint16(p + 28, true);
    const largoExtra = vista.getUint16(p + 30, true);
    const largoComentario = vista.getUint16(p + 32, true);
    const local = vista.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + largoNombre));
    entradas.push({ nombre, metodo, comprimido, local });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  const kml = entradas.find((e) => e.nombre.toLowerCase() === 'doc.kml') ?? entradas.find((e) => e.nombre.toLowerCase().endsWith('.kml'));
  if (!kml) throw new Error('El KMZ no tiene un archivo KML adentro.');
  const inicio = kml.local + 30 + vista.getUint16(kml.local + 26, true) + vista.getUint16(kml.local + 28, true);
  const datos = zip.slice(inicio, inicio + kml.comprimido);
  if (kml.metodo === 0) return new TextDecoder().decode(datos);
  if (kml.metodo !== 8) throw new Error('El KMZ usa una compresión que no se puede leer.');
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(flujo).text();
}
