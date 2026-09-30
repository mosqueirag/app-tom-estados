import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BUCKET_VOZ } from '@/lib/notasVoz';
import { Aviso, Cargando, Modal } from '@/components/ui';

/** Reproduce la nota de voz de una lectura (bucket privado: link que dura una hora). */
export function EscucharNota({ titulo, path, alCerrar }: { titulo: string; path: string | null; alCerrar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!path) return;
    let vigente = true;
    void supabase.storage
      .from(BUCKET_VOZ)
      .createSignedUrl(path, 3600)
      .then(({ data, error: e }) => {
        if (!vigente) return;
        if (e || !data) setError('No se pudo abrir la nota de voz. Puede que todavía se esté subiendo desde el celular.');
        else setUrl(data.signedUrl);
      });
    return () => {
      vigente = false;
    };
  }, [path]);

  return (
    <Modal titulo={titulo} abierto={path !== null} alCerrar={alCerrar}>
      {error ? (
        <Aviso tono="error">{error}</Aviso>
      ) : url ? (
        <audio src={url} controls autoPlay className="w-full" aria-label="Nota de voz" />
      ) : (
        <Cargando />
      )}
    </Modal>
  );
}
