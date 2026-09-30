import { supabase } from './supabase';
import { db, leerDescarga, type CuentaLocal, type LecturaLocal } from './db';
import { mensajeError, traerTodo } from './consultas';
import { BUCKET_FOTOS, rutaFoto } from './fotos';
import { BUCKET_VOZ, rutaAudio, tipoBase } from './notasVoz';
import type { LecturaParaSincronizar } from '@/types/database';

const LOTE = 100;

export type ResultadoSync = { enviadas: number; conflictos: number; rechazadas: number; error: string | null };

function esErrorDeConexion(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? String(e);
  return !navigator.onLine || /failed to fetch|network|load failed|fetch|timeout|ERR_/i.test(m);
}

async function guardarEstadoSync(error: string | null) {
  await db.meta.put({ clave: 'sincronizacion', fecha: new Date().toISOString(), error });
}

/** Garantiza una sesión con token vigente (lo renueva si hace falta). */
async function exigirSesion(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    if (esErrorDeConexion(error)) throw new Error('Sin conexión con el servidor.');
    throw new Error('Tu sesión venció. Cerrá sesión y volvé a ingresar con internet (tus lecturas quedan guardadas).');
  }
  return data.session.user.id;
}

let enCurso: Promise<ResultadoSync> | null = null;

/**
 * Envía al servidor las lecturas pendientes del operador. Se puede llamar
 * muchas veces: si ya hay una sincronización en curso devuelve esa misma.
 * Reintentar es seguro: el servidor usa el id del celular (upsert por id).
 */
export function sincronizar(operadorId: string): Promise<ResultadoSync> {
  if (!enCurso) enCurso = hacerSincronizacion(operadorId).finally(() => (enCurso = null));
  return enCurso;
}

async function hacerSincronizacion(operadorId: string): Promise<ResultadoSync> {
  const r: ResultadoSync = { enviadas: 0, conflictos: 0, rechazadas: 0, error: null };
  const pendientes = await db.lecturas.where({ operador_id: operadorId, estado: 'pendiente' }).sortBy('fecha_lectura');
  if (!pendientes.length) {
    if (navigator.onLine) await enviarExtras(operadorId).catch(() => undefined);
    await guardarEstadoSync(null);
    return r;
  }
  if (!navigator.onLine) {
    r.error = 'Sin conexión.';
    return r;
  }

  try {
    const uid = await exigirSesion();
    if (uid !== operadorId) throw new Error('La sesión es de otro usuario.');

    for (let i = 0; i < pendientes.length; i += LOTE) {
      const lote = pendientes.slice(i, i + LOTE);
      const cuerpo: LecturaParaSincronizar[] = lote.map((l) => ({
        id: l.id,
        cuenta_id: l.cuenta_id,
        periodo_id: l.periodo_id,
        lectura_actual: l.sin_lectura ? null : l.lectura_actual,
        observacion: l.observacion,
        sin_lectura: l.sin_lectura,
        fecha_lectura: l.fecha_lectura,
      }));
      const { data, error } = await supabase.rpc('sincronizar_lecturas', { p_lecturas: cuerpo });
      if (error) throw error;

      const ahora = new Date().toISOString();
      const porId = new Map((data ?? []).map((d) => [d.lectura_id, d]));
      await db.transaction('rw', db.lecturas, async () => {
        for (const l of lote) {
          const res = porId.get(l.id);
          if (!res) {
            await db.lecturas.update(l.id, { intentos: l.intentos + 1 });
            continue;
          }
          if (res.estado === 'sincronizada') r.enviadas++;
          if (res.estado === 'conflicto') r.conflictos++;
          if (res.estado === 'rechazada') r.rechazadas++;
          await db.lecturas.update(l.id, {
            estado: res.estado === 'sincronizada' ? 'enviada' : res.estado,
            mensaje: res.mensaje,
            enviada_at: ahora,
            intentos: l.intentos + 1,
          });
        }
      });
    }
    await enviarExtras(operadorId);
    await guardarEstadoSync(null);
  } catch (e) {
    r.error = esErrorDeConexion(e) ? 'Sin conexión con el servidor. Se reintenta solo.' : mensajeError(e);
    await guardarEstadoSync(r.error);
  }
  return r;
}

/**
 * Sube las fotos y manda la ubicación de las lecturas que ya llegaron al
 * servidor. Si una foto no se puede subir, queda para la próxima vez.
 */
async function enviarExtras(operadorId: string) {
  const conExtras = (await db.lecturas.where('operador_id').equals(operadorId).toArray()).filter(
    (l) => l.extras_pendientes && (l.estado === 'enviada' || l.estado === 'conflicto'),
  );
  if (!conExtras.length) return;

  const listos: {
    lectura: LecturaLocal;
    item: { id: string; latitud: number | null; longitud: number | null; precision: number | null; foto_path: string | null; audio_path: string | null };
  }[] = [];
  for (const l of conExtras) {
    let fotoPath: string | null = null;
    if (l.tiene_foto) {
      const foto = await db.fotos.get(l.id);
      if (foto) {
        fotoPath = rutaFoto(operadorId, l.id);
        const { error } = await supabase.storage
          .from(BUCKET_FOTOS)
          .upload(fotoPath, foto.blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '31536000' });
        if (error) {
          if (esErrorDeConexion(error)) throw error;
          continue; // se reintenta en la próxima sincronización
        }
      }
    }
    let audioPath: string | null = null;
    if (l.tiene_audio) {
      const audio = await db.audios.get(l.id);
      if (audio) {
        audioPath = rutaAudio(operadorId, l.id, audio.tipo);
        const { error } = await supabase.storage
          .from(BUCKET_VOZ)
          .upload(audioPath, audio.blob, { upsert: true, contentType: tipoBase(audio.tipo), cacheControl: '31536000' });
        if (error) {
          if (esErrorDeConexion(error)) throw error;
          continue; // se reintenta en la próxima sincronización
        }
      }
    }
    listos.push({
      lectura: l,
      item: {
        id: l.id,
        latitud: l.latitud ?? null,
        longitud: l.longitud ?? null,
        precision: l.precision_gps ?? null,
        foto_path: fotoPath,
        audio_path: audioPath,
      },
    });
  }
  for (let i = 0; i < listos.length; i += LOTE) {
    const lote = listos.slice(i, i + LOTE);
    const { error } = await supabase.rpc('registrar_extras_lecturas', { p_extras: lote.map((x) => x.item) });
    if (error) throw error;
    await db.transaction('rw', db.lecturas, db.fotos, db.audios, async () => {
      for (const { lectura } of lote) {
        await db.lecturas.update(lectura.id, { extras_pendientes: false });
        await db.fotos.delete(lectura.id);
        await db.audios.delete(lectura.id);
      }
    });
  }
}

/**
 * Descarga las cuentas activas, el período activo y el umbral de alerta, y
 * los guarda en el celular. Primero intenta enviar lo pendiente.
 */
export async function descargarCuentas(operadorId: string): Promise<{ cantidad: number; periodo: string | null }> {
  await sincronizar(operadorId);
  await exigirSesion();

  const [{ data: periodo, error: e1 }, { data: config, error: e2 }] = await Promise.all([
    supabase.from('periodos').select('*').eq('activo', true).maybeSingle(),
    supabase.from('configuracion').select('umbral_consumo_anomalo, foto_obligatoria, localidad').eq('id', 1).maybeSingle(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const cuentas = await traerTodo<CuentaLocal>((d, h) =>
    supabase
      .from('cuentas')
      .select('id, numero_cuenta, titular, direccion, medidor, ultima_lectura, fecha_ultima_lectura, ultimo_consumo, ruta, orden, latitud, longitud')
      .eq('activa', true)
      .order('numero_cuenta')
      .range(d, h),
  );

  // Lecturas propias que ya están en el servidor (por si se borró el celular o
  // el admin resolvió un conflicto a favor de este operador).
  const propias = periodo
    ? await traerTodo<{ id: string; cuenta_id: string; lectura_actual: number | null; lectura_anterior: number | null; consumo: number | null; observacion: string | null; sin_lectura: boolean; fecha_lectura: string; sincronizado_at: string }>((d, h) =>
        supabase
          .from('lecturas')
          .select('id, cuenta_id, lectura_actual, lectura_anterior, consumo, observacion, sin_lectura, fecha_lectura, sincronizado_at')
          .eq('periodo_id', periodo.id)
          .eq('operador_id', operadorId)
          .range(d, h),
      )
    : [];

  const porCuenta = new Map(cuentas.map((c) => [c.id, c]));
  await db.transaction('rw', db.cuentas, db.lecturas, db.meta, async () => {
    await db.cuentas.clear();
    await db.cuentas.bulkPut(cuentas);
    for (const p of propias) {
      const local = await db.lecturas.get(p.id);
      if (local) {
        if (local.estado !== 'enviada') await db.lecturas.update(p.id, { estado: 'enviada', mensaje: null });
        continue;
      }
      const c = porCuenta.get(p.cuenta_id);
      await db.lecturas.put({
        id: p.id,
        cuenta_id: p.cuenta_id,
        periodo_id: periodo!.id,
        operador_id: operadorId,
        numero_cuenta: c?.numero_cuenta ?? '',
        titular: c?.titular ?? '',
        lectura_anterior: p.lectura_anterior,
        lectura_actual: p.lectura_actual,
        consumo: p.consumo,
        observacion: p.observacion,
        sin_lectura: p.sin_lectura,
        fecha_lectura: p.fecha_lectura,
        estado: 'enviada',
        mensaje: null,
        enviada_at: p.sincronizado_at,
        intentos: 0,
      });
    }
    await db.meta.put({
      clave: 'descarga',
      operador_id: operadorId,
      periodo: periodo ?? null,
      umbral: Number(config?.umbral_consumo_anomalo ?? 3),
      foto_obligatoria: Boolean(config?.foto_obligatoria),
      localidad: config?.localidad ?? '',
      fecha: new Date().toISOString(),
      cantidad: cuentas.length,
    });
  });

  return { cantidad: cuentas.length, periodo: periodo?.nombre ?? null };
}

/** Guarda una lectura confirmada en el celular con estado "pendiente" (y su foto, si hay una nueva). */
export async function guardarLecturaLocal(
  l: Omit<LecturaLocal, 'estado' | 'mensaje' | 'enviada_at' | 'intentos'>,
  foto?: Blob | null,
  audio?: { blob: Blob; tipo: string } | null,
) {
  const existente = await db.lecturas.where({ periodo_id: l.periodo_id, cuenta_id: l.cuenta_id }).filter((x) => x.operador_id === l.operador_id).first();
  if (existente && existente.id !== l.id) throw new Error('Esta cuenta ya fue leída en este período desde este celular.');
  if (existente && existente.estado !== 'pendiente') throw new Error('Esta lectura ya fue enviada y no se puede modificar desde el celular.');
  const tieneFoto = Boolean(foto) || Boolean(existente?.tiene_foto);
  // audio === null: se borró la nota; undefined: se deja la que había
  const tieneAudio = audio === undefined ? Boolean(existente?.tiene_audio) : audio !== null;
  await db.transaction('rw', db.lecturas, db.fotos, db.audios, async () => {
    if (foto) await db.fotos.put({ lectura_id: l.id, blob: foto, creada_at: new Date().toISOString() });
    if (audio) await db.audios.put({ lectura_id: l.id, blob: audio.blob, tipo: audio.tipo, creada_at: new Date().toISOString() });
    else if (audio === null) await db.audios.delete(l.id);
    await db.lecturas.put({
      ...l,
      tiene_foto: tieneFoto,
      tiene_audio: tieneAudio,
      extras_pendientes: tieneFoto || tieneAudio || l.latitud != null,
      estado: 'pendiente',
      mensaje: null,
      enviada_at: null,
      intentos: 0,
    });
  });
}

export { leerDescarga };
