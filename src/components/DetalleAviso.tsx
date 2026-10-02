import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Camera, ClipboardList, MapPin, Mic, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { BUCKET_FOTOS } from '@/lib/fotos';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { linkMapa } from '@/lib/ubicacion';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Insignia, Modal } from '@/components/ui';
import { EscucharNota } from '@/components/EscucharNota';
import type { VLectura } from '@/types/database';
import type { AvisoLectura } from '@/components/AvisosLecturas';

/** Ventana con el detalle de una lectura (o conflicto) que llegó a la campana. */
export function DetalleAviso({ aviso, alCerrar }: { aviso: AvisoLectura | null; alCerrar: () => void }) {
  const [oirNota, setOirNota] = useState(false);

  const lectura = useConsulta(async () => {
    if (!aviso || aviso.tipo !== 'lectura') return null;
    const { data, error } = await supabase.from('v_lecturas').select('*').eq('id', aviso.id).maybeSingle();
    if (error) throw error;
    return data as VLectura | null;
  }, [aviso?.id, aviso?.tipo]);

  const l = lectura.datos;
  const foto = useFoto(l?.foto_path ?? null);

  // Lo que se muestra: lo último del servidor y, si no hay señal, lo que guardó la campana
  const d = {
    numero_cuenta: l?.numero_cuenta ?? aviso?.numero_cuenta ?? '',
    titular: l?.titular ?? aviso?.titular ?? '',
    operador: l?.operador_nombre ?? aviso?.operador_nombre ?? 'Operador',
    lectura_actual: l ? l.lectura_actual : aviso?.lectura_actual ?? null,
    consumo: l ? l.consumo : aviso?.consumo ?? null,
    sin_lectura: l?.sin_lectura ?? aviso?.sin_lectura ?? false,
    observacion: l ? l.observacion : aviso?.observacion ?? null,
    fecha: l?.fecha_lectura ?? aviso?.fecha_lectura ?? '',
    menor: l?.alerta_menor_anterior ?? aviso?.alerta_menor_anterior ?? false,
    anomalo: l?.alerta_consumo_anomalo ?? aviso?.alerta_consumo_anomalo ?? false,
  };
  const destino = aviso?.tipo === 'conflicto' ? '/admin/lecturas?vista=conflictos' : `/admin/lecturas?q=${encodeURIComponent(d.numero_cuenta)}`;

  return (
    <>
      <Modal titulo={aviso ? `Cuenta ${d.numero_cuenta}` : ''} abierto={aviso !== null} alCerrar={alCerrar}>
        {aviso && (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-semibold">{d.titular}</p>
              {l && (
                <p className="text-sm text-slate-600">
                  {l.direccion}
                  {l.ruta ? ` · ${l.ruta}` : ''} · Medidor {l.medidor}
                </p>
              )}
            </div>

            {(aviso.tipo === 'conflicto' || d.menor || d.anomalo || d.sin_lectura || l?.corregida_at) && (
              <div className="flex flex-wrap gap-1">
                {aviso.tipo === 'conflicto' && <Insignia color="amarillo">Conflicto: otra lectura para la misma cuenta</Insignia>}
                {d.menor && <Insignia color="rojo">Menor a la anterior</Insignia>}
                {d.anomalo && <Insignia color="amarillo">Consumo anómalo</Insignia>}
                {d.sin_lectura && <Insignia>Sin lectura</Insignia>}
                {l?.corregida_at && <Insignia color="violeta">Corregida por {l.corregida_por_nombre ?? 'admin'}</Insignia>}
              </div>
            )}

            <dl className="grid grid-cols-3 gap-2 text-center">
              <Dato titulo="Anterior" valor={l ? fmtNumero(l.lectura_anterior) : '—'} />
              <Dato titulo="Actual" valor={d.sin_lectura ? '—' : fmtNumero(d.lectura_actual)} destacado />
              <Dato titulo="Consumo" valor={d.consumo === null ? '—' : fmtNumero(d.consumo)} />
            </dl>

            <dl className="space-y-1 text-sm">
              <Fila titulo="Operador" valor={d.operador} />
              <Fila titulo="Tomada" valor={d.fecha ? fmtFechaHora(d.fecha) : '—'} />
              <Fila titulo="Llegó" valor={fmtFechaHora(aviso.recibida_at)} />
              {l?.ultimo_consumo != null && <Fila titulo="Consumo del período anterior" valor={fmtNumero(l.ultimo_consumo)} />}
              {d.observacion && <Fila titulo="Observación" valor={`“${d.observacion}”`} />}
              {l?.precision_gps != null && <Fila titulo="Precisión GPS" valor={`±${Math.round(l.precision_gps)} m`} />}
            </dl>

            {lectura.cargando && !l && aviso.tipo === 'lectura' && <Cargando texto="Buscando el detalle…" />}
            {lectura.error && <Aviso tono="alerta">No se pudo traer el detalle completo: se muestra lo que llegó en el aviso.</Aviso>}
            {aviso.tipo === 'lectura' && !lectura.cargando && !lectura.error && !l && (
              <Aviso tono="alerta">
                <TriangleAlert className="mr-1 inline size-4" aria-hidden="true" />
                Esta lectura ya no está (se borró o se reemplazó).
              </Aviso>
            )}

            {l?.foto_path && (
              <figure>
                <figcaption className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700">
                  <Camera className="size-4" aria-hidden="true" /> Foto del medidor
                </figcaption>
                {foto.url ? (
                  <a href={foto.url} target="_blank" rel="noreferrer">
                    <img src={foto.url} alt={`Foto del medidor de la cuenta ${d.numero_cuenta}`} className="max-h-72 w-full rounded-xl object-contain" />
                  </a>
                ) : foto.error ? (
                  <p className="text-sm text-slate-500">{foto.error}</p>
                ) : (
                  <Cargando texto="Cargando foto…" />
                )}
              </figure>
            )}

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {l && l.latitud !== null && l.longitud !== null && (
                <a className="boton-chico gap-1" href={linkMapa(l)} target="_blank" rel="noreferrer">
                  <MapPin className="size-4" aria-hidden="true" /> Ver en el mapa
                </a>
              )}
              {l?.audio_path && (
                <button className="boton-chico gap-1" onClick={() => setOirNota(true)}>
                  <Mic className="size-4" aria-hidden="true" /> Escuchar nota
                </button>
              )}
              <Link to={destino} className="boton-chico gap-1" onClick={alCerrar}>
                <ClipboardList className="size-4" aria-hidden="true" />
                {aviso.tipo === 'conflicto' ? 'Ir a conflictos' : 'Abrir en Lecturas'}
              </Link>
            </div>
          </div>
        )}
      </Modal>
      <EscucharNota
        titulo={`Nota de voz · cuenta ${d.numero_cuenta}`}
        path={oirNota ? (l?.audio_path ?? null) : null}
        alCerrar={() => setOirNota(false)}
      />
    </>
  );
}

function useFoto(path: string | null) {
  const [estado, setEstado] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    setEstado({ url: null, error: null });
    if (!path) return;
    let vigente = true;
    void supabase.storage
      .from(BUCKET_FOTOS)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!vigente) return;
        setEstado(error || !data ? { url: null, error: 'La foto todavía no está disponible.' } : { url: data.signedUrl, error: null });
      });
    return () => {
      vigente = false;
    };
  }, [path]);
  return estado;
}

function Dato({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`rounded-xl p-2 ${destacado ? 'fondo-marca-suave border border-marca-100' : 'bg-slate-50'}`}>
      <dt className="text-xs text-slate-500">{titulo}</dt>
      <dd className="text-lg font-bold tabular-nums">{valor}</dd>
    </div>
  );
}

function Fila({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{titulo}</dt>
      <dd className="text-right font-medium">{valor}</dd>
    </div>
  );
}
