import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BUCKET_FOTOS } from '@/lib/fotos';
import { Aviso, Cargando, Modal } from '@/components/ui';

/** Muestra la foto del medidor (bucket privado: se pide un link que dura una hora). */
export function VerFoto({ titulo, path, alCerrar }: { titulo: string; path: string | null; alCerrar: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!path) return;
    let vigente = true;
    void supabase.storage
      .from(BUCKET_FOTOS)
      .createSignedUrl(path, 3600)
      .then(({ data, error: e }) => {
        if (!vigente) return;
        if (e || !data) setError('No se pudo abrir la foto. Puede que todavía se esté subiendo desde el celular.');
        else setUrl(data.signedUrl);
      });
    return () => {
      vigente = false;
    };
  }, [path]);

  return (
    <Modal titulo={titulo} abierto={path !== null} alCerrar={alCerrar} ancho="max-w-2xl">
      {error ? (
        <Aviso tono="error">{error}</Aviso>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={titulo} className="mx-auto max-h-[70vh] rounded-xl" />
        </a>
      ) : (
        <Cargando />
      )}
    </Modal>
  );
}
