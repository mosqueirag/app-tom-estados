// Notas de voz de las lecturas: se graban en el celular (hasta un minuto) y
// se suben a Storage (bucket privado notas-voz) al sincronizar.

export const BUCKET_VOZ = 'notas-voz';
export const DURACION_MAXIMA = 60; // segundos

// Chrome/Android graba webm (opus); el iPhone graba mp4 (aac).
const TIPOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function tipoDeGrabacion(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return TIPOS.find((t) => MediaRecorder.isTypeSupported?.(t));
}

export function puedeGrabar(): boolean {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Tipo sin parámetros ("audio/webm;codecs=opus" → "audio/webm"), como lo acepta Storage. */
export function tipoBase(tipo: string): string {
  return tipo.split(';')[0].trim() || 'audio/webm';
}

export function extensionAudio(tipo: string): 'webm' | 'm4a' | 'ogg' {
  const t = tipoBase(tipo);
  if (t === 'audio/mp4' || t === 'audio/aac' || t === 'audio/x-m4a') return 'm4a';
  if (t === 'audio/ogg') return 'ogg';
  return 'webm';
}

export function rutaAudio(operadorId: string, lecturaId: string, tipo: string): string {
  return `${operadorId}/${lecturaId}.${extensionAudio(tipo)}`;
}
