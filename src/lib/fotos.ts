// Fotos del medidor: se achican en el celular antes de guardarlas para que
// ocupen poco (≈100 KB) y se suban rápido con poca señal.

const LADO_MAXIMO = 1280;
const CALIDAD = 0.7;

export async function comprimirFoto(archivo: Blob): Promise<Blob> {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
  const ancho = Math.round(imagen.width * escala);
  const alto = Math.round(imagen.height * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  lienzo.getContext('2d')!.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close();
  const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, 'image/jpeg', CALIDAD));
  if (!blob) throw new Error('No se pudo procesar la foto.');
  return blob;
}

export const BUCKET_FOTOS = 'fotos-medidores';

export function rutaFoto(operadorId: string, lecturaId: string): string {
  return `${operadorId}/${lecturaId}.jpg`;
}
