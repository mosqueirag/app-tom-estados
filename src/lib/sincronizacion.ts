import { supabase } from './supabase';
import { db, leerDescarga, type CuentaLocal, type LecturaLocal } from './db';
import { mensajeError, traerTodo } from './consultas';
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
    await guardarEstadoSync(null);
  } catch (e) {
    r.error = esErrorDeConexion(e) ? 'Sin conexión con el servidor. Se reintenta solo.' : mensajeError(e);
    await guardarEstadoSync(r.error);
  }
  return r;
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
    supabase.from('configuracion').select('umbral_consumo_anomalo').eq('id', 1).maybeSingle(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const cuentas = await traerTodo<CuentaLocal>((d, h) =>
    supabase
      .from('cuentas')
      .select('id, numero_cuenta, titular, direccion, medidor, ultima_lectura, fecha_ultima_lectura, ultimo_consumo, ruta')
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
      fecha: new Date().toISOString(),
      cantidad: cuentas.length,
    });
  });

  return { cantidad: cuentas.length, periodo: periodo?.nombre ?? null };
}

/** Guarda una lectura confirmada en el celular con estado "pendiente". */
export async function guardarLecturaLocal(l: Omit<LecturaLocal, 'estado' | 'mensaje' | 'enviada_at' | 'intentos'>) {
  const existente = await db.lecturas.where({ periodo_id: l.periodo_id, cuenta_id: l.cuenta_id }).filter((x) => x.operador_id === l.operador_id).first();
  if (existente && existente.id !== l.id) throw new Error('Esta cuenta ya fue leída en este período desde este celular.');
  if (existente && existente.estado !== 'pendiente') throw new Error('Esta lectura ya fue enviada y no se puede modificar desde el celular.');
  await db.lecturas.put({ ...l, estado: 'pendiente', mensaje: null, enviada_at: null, intentos: 0 });
}

export { leerDescarga };
