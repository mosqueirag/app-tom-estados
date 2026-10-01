import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Zona } from '@/types/database';

const COLORES = ['#0d9488', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#059669', '#db2777', '#0891b2', '#65a30d', '#ea580c'];
export const colorDeRuta = (i: number) => COLORES[i % COLORES.length];

export type ZonaEnMapa = { nombre: string; zona: Zona; color: string };
export type PuntoEnMapa = { latitud: number; longitud: number; texto: string; color: string };

/** Mapa con las zonas de las rutas y, si se pasan, las cuentas ubicadas. */
export function MapaZonas({ zonas, puntos = [], alto = 'h-96' }: { zonas: ZonaEnMapa[]; puntos?: PuntoEnMapa[]; alto?: string }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    mapa.current = L.map(contenedor.current, { center: [-34.6, -58.4], zoom: 12, zoomAnimation: false, fadeAnimation: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(mapa.current);
    capa.current = L.layerGroup().addTo(mapa.current);
    return () => {
      mapa.current?.remove();
      mapa.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    const c = capa.current;
    if (!m || !c) return;
    c.clearLayers();
    const limites = L.latLngBounds([]);
    for (const z of zonas) {
      const forma = L.polygon(
        z.zona.map((pol) => pol.map((anillo) => anillo.map(([lng, lat]) => [lat, lng] as L.LatLngTuple))),
        { color: z.color, weight: 2, fillOpacity: 0.15 },
      )
        .bindTooltip(z.nombre, { sticky: true })
        .addTo(c);
      limites.extend(forma.getBounds());
    }
    for (const p of puntos) {
      L.circleMarker([p.latitud, p.longitud], { radius: 5, color: '#fff', weight: 1, fillColor: p.color, fillOpacity: 1 })
        .bindTooltip(p.texto)
        .addTo(c);
      limites.extend([p.latitud, p.longitud]);
    }
    if (limites.isValid()) m.fitBounds(limites, { padding: [20, 20], maxZoom: 16, animate: false });
    const t = setTimeout(() => {
      if (mapa.current === m) m.invalidateSize({ animate: false });
    }, 50);
    return () => clearTimeout(t);
  }, [zonas, puntos]);

  return <div ref={contenedor} className={`${alto} w-full overflow-hidden rounded-xl border border-slate-200`} aria-label="Mapa de zonas" role="region" />;
}
