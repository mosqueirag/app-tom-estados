import { useEffect, useRef, useState } from 'react';
import { DURACION_MAXIMA, puedeGrabar, tipoDeGrabacion } from '@/lib/notasVoz';

export type Nota = { blob: Blob; tipo: string };

/** Graba una nota de voz corta como observación (hasta un minuto). */
export function GrabarNota({ nota, alCambiar }: { nota: Nota | null; alCambiar: (n: Nota | null) => void }) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const grabador = useRef<MediaRecorder | null>(null);
  const reloj = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!nota) return setUrl(null);
    const u = URL.createObjectURL(nota.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [nota]);

  // Si se sale de la pantalla grabando, se corta y se libera el micrófono
  useEffect(
    () => () => {
      window.clearInterval(reloj.current);
      if (grabador.current?.state === 'recording') grabador.current.stop();
    },
    [],
  );

  async function empezar() {
    setError(null);
    let flujo: MediaStream;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'No diste permiso para usar el micrófono. Habilitalo en la configuración del navegador.'
          : 'No se pudo usar el micrófono.',
      );
      return;
    }
    const tipo = tipoDeGrabacion();
    const r = new MediaRecorder(flujo, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined);
    const partes: Blob[] = [];
    r.ondataavailable = (ev) => ev.data.size && partes.push(ev.data);
    r.onstop = () => {
      window.clearInterval(reloj.current);
      flujo.getTracks().forEach((t) => t.stop());
      setGrabando(false);
      const final = r.mimeType || tipo || 'audio/webm';
      if (partes.length) alCambiar({ blob: new Blob(partes, { type: final }), tipo: final });
    };
    grabador.current = r;
    r.start(1000);
    setSegundos(0);
    setGrabando(true);
    const inicio = Date.now();
    reloj.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - inicio) / 1000);
      setSegundos(s);
      if (s >= DURACION_MAXIMA && r.state === 'recording') r.stop();
    }, 250);
  }

  function detener() {
    if (grabador.current?.state === 'recording') grabador.current.stop();
  }

  if (!puedeGrabar()) return null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className="font-medium">Nota de voz (opcional)</p>
      {grabando ? (
        <div className="mt-2 flex items-center gap-3">
          <span className="size-3 animate-pulse rounded-full bg-red-600" aria-hidden />
          <span className="flex-1 tabular-nums" role="timer">
            Grabando… {segundos}s de {DURACION_MAXIMA}s
          </span>
          <button type="button" className="boton-primario min-h-11 px-4" onClick={detener}>
            Terminar
          </button>
        </div>
      ) : url ? (
        <div className="mt-2 flex items-center gap-2">
          <audio src={url} controls className="h-10 min-w-0 flex-1" aria-label="Nota de voz grabada" />
          <button type="button" className="boton-chico" onClick={() => alCambiar(null)}>
            Borrar
          </button>
        </div>
      ) : (
        <button type="button" className="boton-secundario mt-2 min-h-11 px-4" onClick={() => void empezar()}>
          <span aria-hidden>🎙️</span>&nbsp;Grabar nota de voz
        </button>
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}
