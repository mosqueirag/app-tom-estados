import { useEffect, useRef, useState } from 'react';
import { Aviso, Modal } from '@/components/ui';

/**
 * Lee un código QR o de barras con la cámara de atrás. Usa ZXing (anda también
 * en iPhone, donde el navegador no trae lector propio). La librería se carga
 * recién al abrir el lector, para no hacer más pesada la app.
 */
export function EscanearCodigo({ abierto, alCerrar, alLeer }: { abierto: boolean; alCerrar: () => void; alLeer: (texto: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const alLeerRef = useRef(alLeer);
  alLeerRef.current = alLeer;

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    setListo(false);
    let vigente = true;
    let detener: (() => void) | null = null;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este celular no deja usar la cámara desde el navegador.');
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (!vigente || !video.current) return;
        const lector = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500 });
        const controles = await lector.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } }, audio: false },
          video.current,
          (resultado) => {
            if (!resultado || !vigente) return;
            vigente = false;
            detener?.(); // si todavía no hay controles, se detiene apenas vuelvan
            navigator.vibrate?.(80);
            alLeerRef.current(resultado.getText().trim());
          },
        );
        detener = () => controles.stop();
        if (!vigente) controles.stop();
        else setListo(true);
      } catch (e) {
        if (!vigente) return;
        const nombre = (e as Error).name;
        setError(
          nombre === 'NotAllowedError'
            ? 'No diste permiso para usar la cámara. Habilitalo en la configuración del navegador y probá de nuevo.'
            : nombre === 'NotFoundError' || nombre === 'OverconstrainedError'
              ? 'No se encontró una cámara en este equipo.'
              : 'No se pudo abrir la cámara. Cerrá otras apps que la estén usando y probá de nuevo.',
        );
      }
    })();

    return () => {
      vigente = false;
      detener?.();
    };
  }, [abierto]);

  return (
    <Modal titulo="Escanear código del medidor" abierto={abierto} alCerrar={alCerrar}>
      <div className="space-y-3">
        {error ? (
          <Aviso tono="error">{error}</Aviso>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-xl bg-slate-900">
              <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline aria-label="Imagen de la cámara" />
              <div className="pointer-events-none absolute inset-[18%] rounded-lg border-4 border-white/80" aria-hidden />
            </div>
            <p className="text-center text-sm text-slate-600">
              {listo ? 'Apuntá al código QR o de barras de la etiqueta. Se lee solo.' : 'Abriendo la cámara…'}
            </p>
          </>
        )}
        <button type="button" className="boton-secundario w-full" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </Modal>
  );
}

/** Busca la cuenta cuyo número o medidor coincide con el código leído. */
export function cuentaPorCodigo<T extends { numero_cuenta: string; medidor: string }>(cuentas: T[], codigo: string): T[] {
  const limpiar = (s: string) => s.trim().toUpperCase().replace(/^0+(?=.)/, '');
  // Las etiquetas que genera la app dicen "CUENTA:<número>"
  const texto = codigo.replace(/^CUENTA:/i, '');
  const buscado = limpiar(texto);
  const exactas = cuentas.filter((c) => limpiar(c.numero_cuenta) === buscado || limpiar(c.medidor) === buscado);
  return exactas;
}
