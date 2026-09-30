import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '@/lib/supabase';
import { traerTodo } from '@/lib/consultas';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { linkMapa } from '@/lib/ubicacion';
import { useConsulta } from '@/hooks/useConsulta';
import { usePeriodos } from '@/hooks/usePeriodos';
import { useAlCambiarLecturas } from '@/components/AvisosLecturas';
import { VerFoto } from '@/components/VerFoto';
import { EscucharNota } from '@/components/EscucharNota';
import { Aviso, Cargando, Encabezado, Insignia, Tarjeta } from '@/components/ui';
import type { VLectura } from '@/types/database';

const COLORES = {
  menor: '#dc2626',
  anomalo: '#d97706',
  sin: '#64748b',
  normal: '#16a34a',
};

function colorDe(l: VLectura) {
  if (l.alerta_menor_anterior) return COLORES.menor;
  if (l.alerta_consumo_anomalo) return COLORES.anomalo;
  if (l.sin_lectura) return COLORES.sin;
  return COLORES.normal;
}

export default function Mapa() {
  const periodos = usePeriodos();
  const [periodoId, setPeriodoId] = useState('');
  const [operador, setOperador] = useState('');
  const [ruta, setRuta] = useState('');
  const [seleccionada, setSeleccionada] = useState<VLectura | null>(null);
  const [foto, setFoto] = useState<VLectura | null>(null);
  const [nota, setNota] = useState<VLectura | null>(null);
  const idPeriodo = periodoId || periodos.datos?.[0]?.id || '';

  const lecturas = useConsulta(async () => {
    if (!idPeriodo) return [] as VLectura[];
    return traerTodo<VLectura>((d, h) =>
      supabase.from('v_lecturas').select('*').eq('periodo_id', idPeriodo).not('latitud', 'is', null).order('fecha_lectura').range(d, h),
    );
  }, [idPeriodo]);
  useAlCambiarLecturas(() => void lecturas.recargar());

  const todas = lecturas.datos ?? [];
  const operadores = useMemo(() => [...new Map(todas.map((l) => [l.operador_id, l.operador_nombre ?? 'Operador'])).entries()], [todas]);
  const rutas = useMemo(() => [...new Set(todas.map((l) => l.ruta))].sort(), [todas]);
  const visibles = todas.filter((l) => (!operador || l.operador_id === operador) && (!ruta || l.ruta === ruta));

  // ---- Mapa (Leaflet con OpenStreetMap)
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    mapa.current = L.map(contenedor.current, { center: [-34.6, -58.4], zoom: 12 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa.current);
    capa.current = L.layerGroup().addTo(mapa.current);
    return () => {
      mapa.current?.remove();
      mapa.current = null;
    };
  }, []);

  const clave = visibles.map((l) => l.id).join(',');
  useEffect(() => {
    if (!mapa.current || !capa.current) return;
    capa.current.clearLayers();
    const puntos: L.LatLngExpression[] = [];
    for (const l of visibles) {
      const punto: L.LatLngExpression = [l.latitud!, l.longitud!];
      puntos.push(punto);
      L.circleMarker(punto, { radius: 8, color: '#fff', weight: 2, fillColor: colorDe(l), fillOpacity: 0.95 })
        .bindTooltip(`${l.numero_cuenta} · ${l.titular}`)
        .on('click', () => setSeleccionada(l))
        .addTo(capa.current);
    }
    if (puntos.length) mapa.current.fitBounds(L.latLngBounds(puntos), { padding: [30, 30], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return (
    <div className="space-y-4">
      <Encabezado titulo="Mapa de lecturas" />

      <div className="flex flex-wrap gap-2">
        <select className="campo w-auto" value={idPeriodo} onChange={(e) => setPeriodoId(e.target.value)} aria-label="Período">
          {periodos.datos?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} {p.activo ? '(abierto)' : ''}
            </option>
          ))}
        </select>
        <select className="campo w-auto" value={operador} onChange={(e) => setOperador(e.target.value)} aria-label="Operador">
          <option value="">Todos los operadores</option>
          {operadores.map(([id, nombre]) => (
            <option key={id} value={id}>
              {nombre}
            </option>
          ))}
        </select>
        <select className="campo w-auto" value={ruta} onChange={(e) => setRuta(e.target.value)} aria-label="Ruta">
          <option value="">Todas las rutas</option>
          {rutas.map((r) => (
            <option key={r} value={r}>
              {r || 'Sin ruta'}
            </option>
          ))}
        </select>
      </div>

      {lecturas.error && <Aviso tono="error">{lecturas.error}</Aviso>}

      <div className="flex flex-wrap gap-3 text-sm text-slate-600">
        <Referencia color={COLORES.normal} texto="Normal" />
        <Referencia color={COLORES.anomalo} texto="Consumo anómalo" />
        <Referencia color={COLORES.menor} texto="Menor a la anterior" />
        <Referencia color={COLORES.sin} texto="Sin lectura" />
        <span className="ml-auto">{fmtNumero(visibles.length)} lecturas con ubicación</span>
      </div>

      <Tarjeta className="relative isolate overflow-hidden p-0">
        <div ref={contenedor} className="h-[60vh] min-h-80 w-full" role="region" aria-label="Mapa" />
        {lecturas.cargando && !lecturas.datos && (
          <div className="absolute inset-0 grid place-items-center bg-white/70">
            <Cargando />
          </div>
        )}
        {lecturas.datos && visibles.length === 0 && (
          <p className="absolute inset-x-4 top-4 z-[500] rounded-xl bg-white/95 p-3 text-center text-sm text-slate-600 shadow">
            Todavía no hay lecturas con ubicación en este período. Se registran solas cuando el operador carga la lectura con el GPS prendido.
          </p>
        )}
      </Tarjeta>

      {seleccionada && (
        <Tarjeta>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">
                {seleccionada.numero_cuenta} · {seleccionada.titular}
              </p>
              <p className="text-sm text-slate-600">
                {seleccionada.direccion} · {seleccionada.ruta || 'Sin ruta'}
              </p>
              <p className="mt-1 text-sm">
                {seleccionada.sin_lectura ? `Sin lectura: ${seleccionada.observacion ?? ''}` : `Lectura ${fmtNumero(seleccionada.lectura_actual)} · consumo ${fmtNumero(seleccionada.consumo)}`}
              </p>
              <p className="text-sm text-slate-600">
                {seleccionada.operador_nombre} · {fmtFechaHora(seleccionada.fecha_lectura)}
                {seleccionada.precision_gps ? ` · ±${Math.round(seleccionada.precision_gps)} m` : ''}
              </p>
              <div className="mt-1 flex gap-1">
                {seleccionada.alerta_menor_anterior && <Insignia color="rojo">Menor a la anterior</Insignia>}
                {seleccionada.alerta_consumo_anomalo && <Insignia color="amarillo">Consumo anómalo</Insignia>}
              </div>
            </div>
            <div className="flex gap-2">
              {seleccionada.foto_path && (
                <button className="boton-chico" onClick={() => setFoto(seleccionada)}>
                  Ver foto
                </button>
              )}
              {seleccionada.audio_path && (
                <button className="boton-chico" onClick={() => setNota(seleccionada)}>
                  Escuchar nota
                </button>
              )}
              <a className="boton-chico" href={linkMapa(seleccionada)} target="_blank" rel="noreferrer">
                Abrir en Google Maps
              </a>
            </div>
          </div>
        </Tarjeta>
      )}

      <EscucharNota titulo={nota ? `Nota de voz · cuenta ${nota.numero_cuenta}` : ''} path={nota?.audio_path ?? null} alCerrar={() => setNota(null)} />
      <VerFoto titulo={foto ? `Cuenta ${foto.numero_cuenta}` : ''} path={foto?.foto_path ?? null} alCerrar={() => setFoto(null)} />
    </div>
  );
}

function Referencia({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-3 rounded-full" style={{ background: color }} aria-hidden />
      {texto}
    </span>
  );
}
