import { useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion, mensajeError, traerTodo } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { leerArchivoZonas, rutaSugerida, type ZonaKml } from '@/lib/kml';
import { buscarDireccion, esperar, PAUSA_MS, type Area } from '@/lib/geocodificar';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, BarraProgreso, Modal, Tarjeta } from '@/components/ui';
import { colorDeRuta, MapaZonas, type PuntoEnMapa, type ZonaEnMapa } from '@/components/MapaZonas';
import type { VRuta, Zona } from '@/types/database';

type Mensaje = { tono: 'exito' | 'error' | 'info'; texto: string };
const NO_USAR = '';

/**
 * Zonas de las rutas: se importan de un KML y cada cuenta con ubicación pasa
 * sola a la ruta de su zona (y con eso a su operador).
 */
export function ZonasRutas({ rutas, alCambiar }: { rutas: VRuta[]; alCambiar: () => void }) {
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [importando, setImportando] = useState(false);
  const [verMapa, setVerMapa] = useState(false);
  const [asignando, setAsignando] = useState(false);
  const [ubicando, setUbicando] = useState<{ hechas: number; total: number; encontradas: number } | null>(null);
  const cancelar = useRef<AbortController | null>(null);

  const conNombre = useMemo(() => rutas.filter((r) => r.ruta !== ''), [rutas]);
  const conZona = conNombre.filter((r) => r.tiene_zona).length;

  const datos = useConsulta(async () => {
    const [{ data: zonas, error: e1 }, cuentas, { count: sinUbicacion, error: e2 }] = await Promise.all([
      supabase.from('rutas').select('nombre, zona').not('zona', 'is', null),
      traerTodo<{ numero_cuenta: string; ruta: string; latitud: number; longitud: number | null }>((d, h) =>
        supabase
          .from('cuentas')
          .select('numero_cuenta, ruta, latitud, longitud')
          .eq('activa', true)
          .not('latitud', 'is', null)
          .range(d, h),
      ),
      supabase.from('cuentas').select('id', { count: 'exact', head: true }).eq('activa', true).is('latitud', null),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    return { zonas: (zonas ?? []) as { nombre: string; zona: Zona }[], cuentas, sinUbicacion: sinUbicacion ?? 0 };
  }, [rutas]);

  const orden = useMemo(() => new Map(conNombre.map((r, i) => [r.ruta, i])), [conNombre]);
  const zonasMapa: ZonaEnMapa[] = useMemo(
    () => (datos.datos?.zonas ?? []).map((z) => ({ nombre: z.nombre, zona: z.zona, color: colorDeRuta(orden.get(z.nombre) ?? 0) })),
    [datos.datos, orden],
  );
  const puntosMapa: PuntoEnMapa[] = useMemo(
    () =>
      (datos.datos?.cuentas ?? []).filter((c) => c.longitud !== null).map((c) => ({
        latitud: c.latitud,
        longitud: c.longitud!,
        texto: `${c.numero_cuenta} · ${c.ruta || 'sin ruta'}`,
        color: c.ruta && orden.has(c.ruta) ? colorDeRuta(orden.get(c.ruta)!) : '#64748b',
      })),
    [datos.datos, orden],
  );

  async function asignar(reemplazar: boolean) {
    setAsignando(true);
    setMensaje(null);
    try {
      const { data, error } = await supabase.rpc('asignar_rutas_por_zona', { p_reemplazar: reemplazar });
      if (error) throw error;
      const r = data!;
      let avisos = '';
      if (r.ids.length) {
        const aviso = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { avisar: 'nuevas', cuenta_ids: r.ids }).catch(() => null);
        avisos = aviso?.mensaje ? ` ${aviso.mensaje}` : '';
      }
      const partes = [
        r.asignadas
          ? `Listo: ${fmtNumero(r.asignadas)} ${r.asignadas === 1 ? 'cuenta pasó' : 'cuentas pasaron'} a la ruta de su zona.${avisos}`
          : 'No hubo cuentas para cambiar de ruta.',
      ];
      if (r.sin_ubicacion)
        partes.push(`${fmtNumero(r.sin_ubicacion)} ${r.sin_ubicacion === 1 ? 'no tiene' : 'no tienen'} ubicación: usá "Ubicar cuentas por dirección".`);
      if (r.fuera_de_zona) partes.push(`${fmtNumero(r.fuera_de_zona)} ${r.fuera_de_zona === 1 ? 'queda' : 'quedan'} fuera de todas las zonas.`);
      setMensaje({ tono: 'exito', texto: partes.join(' ') });
      alCambiar();
    } catch (e) {
      setMensaje({ tono: 'error', texto: mensajeError(e) });
    } finally {
      setAsignando(false);
    }
  }

  async function ubicarPorDireccion() {
    setMensaje(null);
    const { data: config } = await supabase.from('configuracion').select('localidad').eq('id', 1).maybeSingle();
    const localidad = config?.localidad?.trim() ?? '';
    // Se busca dentro del área de las zonas importadas (así no hace falta el nombre de la ciudad)
    const { data: zonas } = await supabase
      .from('rutas')
      .select('zona_min_lat, zona_max_lat, zona_min_lng, zona_max_lng')
      .not('zona', 'is', null);
    const conArea = (zonas ?? []).filter((z) => z.zona_min_lat != null && z.zona_max_lat != null && z.zona_min_lng != null && z.zona_max_lng != null);
    const area: Area | null = conArea.length
      ? {
          minLat: Math.min(...conArea.map((z) => z.zona_min_lat as number)),
          maxLat: Math.max(...conArea.map((z) => z.zona_max_lat as number)),
          minLng: Math.min(...conArea.map((z) => z.zona_min_lng as number)),
          maxLng: Math.max(...conArea.map((z) => z.zona_max_lng as number)),
        }
      : null;
    if (!area && !localidad) {
      setMensaje({ tono: 'error', texto: 'Primero importá el KML de las zonas: las direcciones se buscan dentro de esa área.' });
      return;
    }
    let cuentas: { id: string; direccion: string }[];
    try {
      cuentas = await traerTodo<{ id: string; direccion: string }>((d, h) =>
        supabase.from('cuentas').select('id, direccion').eq('activa', true).is('latitud', null).order('numero_cuenta').range(d, h),
      );
    } catch (e) {
      setMensaje({ tono: 'error', texto: mensajeError(e) });
      return;
    }
    if (!cuentas.length) {
      setMensaje({ tono: 'info', texto: 'Todas las cuentas ya tienen ubicación.' });
      return;
    }
    const control = new AbortController();
    cancelar.current = control;
    let encontradas = 0;
    let hechas = 0;
    setUbicando({ hechas, total: cuentas.length, encontradas });
    try {
      for (const c of cuentas) {
        const punto = await buscarDireccion(c.direccion, localidad, control.signal, area);
        if (punto) {
          // Al guardar la ubicación, si la cuenta no tiene ruta toma la de su zona
          const { error } = await supabase.from('cuentas').update(punto).eq('id', c.id);
          if (error) throw error;
          encontradas++;
        }
        hechas++;
        setUbicando({ hechas, total: cuentas.length, encontradas });
        if (hechas < cuentas.length) await esperar(PAUSA_MS, control.signal);
      }
      setMensaje({
        tono: 'exito',
        texto: `Se ubicaron ${fmtNumero(encontradas)} de ${fmtNumero(cuentas.length)} cuentas por su dirección.${
          encontradas < cuentas.length ? ' Las demás no se encontraron en el mapa: revisá cómo está escrita la dirección.' : ''
        } Ahora tocá "Asignar cuentas por zona".`,
      });
    } catch (e) {
      const cancelado = e instanceof DOMException && e.name === 'AbortError';
      setMensaje({
        tono: cancelado ? 'info' : 'error',
        texto: cancelado
          ? `Se detuvo. Se ubicaron ${fmtNumero(encontradas)} cuentas; podés seguir después desde donde quedó.`
          : `${mensajeError(e)} Se ubicaron ${fmtNumero(encontradas)} cuentas.`,
      });
    } finally {
      cancelar.current = null;
      setUbicando(null);
      alCambiar();
    }
  }

  const sinUbicacion = datos.datos?.sinUbicacion ?? 0;
  const ocupado = asignando || ubicando !== null;

  return (
    <Tarjeta className="mb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Zonas de las rutas (mapa)</h2>
        <p className="text-sm text-slate-600">
          {fmtNumero(conZona)} de {fmtNumero(conNombre.length)} rutas con zona · {fmtNumero(sinUbicacion)} cuentas sin ubicación
        </p>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Subí un archivo <strong>KML o KMZ</strong> con la zona de cada ruta dibujada como un polígono (Google My Maps o Google Earth).
        Cada cuenta ubicada en el mapa pasa sola a la ruta de su zona y, con eso, a su operador.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="boton-primario" onClick={() => setImportando(true)} disabled={ocupado}>
          Importar KML
        </button>
        <button className="boton-secundario" onClick={() => void ubicarPorDireccion()} disabled={ocupado || sinUbicacion === 0}>
          Ubicar cuentas por dirección
        </button>
        <button className="boton-secundario" onClick={() => void asignar(false)} disabled={ocupado || conZona === 0}>
          {asignando ? 'Asignando…' : 'Asignar cuentas por zona'}
        </button>
        <button
          className="boton-chico"
          onClick={() => {
            if (confirm('¿Revisar todas las cuentas ubicadas?\n\nLas que estén en la zona de otra ruta se pasan a esa ruta y a su operador.')) void asignar(true);
          }}
          disabled={ocupado || conZona === 0}
        >
          Reasignar todas por zona
        </button>
        <button className="boton-chico" onClick={() => setVerMapa((v) => !v)}>
          {verMapa ? 'Ocultar mapa' : 'Ver mapa'}
        </button>
      </div>

      {ubicando && (
        <div className="mt-3 space-y-2" aria-live="polite">
          <p className="text-sm">
            Ubicando cuentas por dirección: {fmtNumero(ubicando.hechas)} de {fmtNumero(ubicando.total)} ({fmtNumero(ubicando.encontradas)} encontradas). Va de a una por
            segundo; podés seguir usando la app en otra pestaña.
          </p>
          <BarraProgreso valor={ubicando.hechas} total={ubicando.total} />
          <button className="boton-chico" onClick={() => cancelar.current?.abort()}>
            Detener
          </button>
        </div>
      )}
      {mensaje && (
        <Aviso tono={mensaje.tono} className="mt-3">
          {mensaje.texto}
        </Aviso>
      )}
      {datos.error && <Aviso tono="error" className="mt-3">{datos.error}</Aviso>}
      {verMapa && (
        <div className="mt-3">
          <MapaZonas zonas={zonasMapa} puntos={puntosMapa} />
          {zonasMapa.length === 0 && <p className="mt-2 text-sm text-slate-500">Todavía no hay zonas cargadas.</p>}
        </div>
      )}

      <ImportarZonas
        abierto={importando}
        rutas={conNombre.map((r) => r.ruta)}
        alCerrar={() => setImportando(false)}
        alGuardar={(texto) => {
          setImportando(false);
          setMensaje({ tono: 'exito', texto });
          alCambiar();
        }}
      />
    </Tarjeta>
  );
}

function ImportarZonas({
  abierto,
  rutas,
  alCerrar,
  alGuardar,
}: {
  abierto: boolean;
  rutas: string[];
  alCerrar: () => void;
  alGuardar: (texto: string) => void;
}) {
  const [zonas, setZonas] = useState<ZonaKml[]>([]);
  const [destino, setDestino] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function leer(archivo: File | undefined) {
    setError(null);
    setZonas([]);
    if (!archivo) return;
    try {
      const leidas = await leerArchivoZonas(archivo);
      setZonas(leidas);
      setDestino(leidas.map((z) => rutaSugerida(z, rutas)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const opciones = useMemo(() => [...new Set([...rutas, ...destino.filter(Boolean)])], [rutas, destino]);
  const vista: ZonaEnMapa[] = zonas
    .map((z, i) => ({ nombre: destino[i] ? `${z.nombre} → ${destino[i]}` : z.nombre, zona: z.zona, color: destino[i] ? colorDeRuta(Math.max(0, opciones.indexOf(destino[i]))) : '#94a3b8' }));

  async function guardar() {
    const porRuta = new Map<string, Zona>();
    zonas.forEach((z, i) => {
      const r = destino[i]?.trim();
      if (r) porRuta.set(r, [...(porRuta.get(r) ?? []), ...z.zona]);
    });
    if (!porRuta.size) {
      setError('Elegí a qué ruta corresponde cada zona.');
      return;
    }
    setGuardando(true);
    setError(null);
    const filas = [...porRuta].map(([nombre, zona]) => ({ nombre, zona }));
    const { error: e } = await supabase.from('rutas').upsert(filas, { onConflict: 'nombre' });
    setGuardando(false);
    if (e) {
      setError(mensajeError(e));
      return;
    }
    setZonas([]);
    alGuardar(
      `Se guardaron las zonas de ${filas.length} ${filas.length === 1 ? 'ruta' : 'rutas'}: ${filas.map((f) => f.nombre).join(', ')}. Ahora tocá "Asignar cuentas por zona".`,
    );
  }

  return (
    <Modal titulo="Importar zonas (KML)" abierto={abierto} alCerrar={alCerrar} ancho="max-w-3xl">
      <div className="space-y-4">
        <label className="block">
          <span className="etiqueta">Archivo KML o KMZ</span>
          <input type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" onChange={(e) => void leer(e.target.files?.[0])} className="block text-sm" />
        </label>
        {error && <Aviso tono="error">{error}</Aviso>}
        {zonas.length > 0 && (
          <>
            <p className="text-sm text-slate-600">
              Se encontraron {zonas.length} {zonas.length === 1 ? 'zona' : 'zonas'}. Revisá a qué ruta va cada una (si el nombre tiene un número, se elige esa ruta).
            </p>
            <MapaZonas zonas={vista} alto="h-72" />
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200" aria-label="Zonas del archivo">
              {zonas.map((z, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="font-medium">{z.nombre || '(sin nombre)'}</span>
                    {z.carpeta && <span className="text-sm text-slate-500"> · {z.carpeta}</span>}
                  </span>
                  <select
                    className="campo w-56 py-2"
                    aria-label={`Ruta de la zona ${z.nombre || i + 1}`}
                    value={destino[i] ?? NO_USAR}
                    onChange={(e) => setDestino((d) => d.map((v, k) => (k === i ? e.target.value : v)))}
                  >
                    <option value={NO_USAR}>No usar</option>
                    {opciones.map((r) => (
                      <option key={r} value={r}>
                        {rutas.includes(r) ? r : `${r} (nueva)`}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button className="boton-secundario" onClick={alCerrar}>
                Cancelar
              </button>
              <button className="boton-primario" onClick={() => void guardar()} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar zonas'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
