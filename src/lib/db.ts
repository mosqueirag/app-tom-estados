import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Cuenta, Periodo } from '@/types/database';

// Base de datos local del celular (IndexedDB). Todo lo que necesita el
// operador para trabajar sin señal vive acá.

export type CuentaLocal = Pick<
  Cuenta,
  'id' | 'numero_cuenta' | 'titular' | 'direccion' | 'medidor' | 'ultima_lectura' | 'fecha_ultima_lectura' | 'ultimo_consumo'
> & {
  // pueden faltar en cuentas descargadas con una versión anterior de la app
  ruta?: string;
  orden?: number | null;
  latitud?: number | null;
  longitud?: number | null;
};

/** pendiente → todavía no llegó al servidor; enviada → guardada; conflicto → otro la leyó / período cerrado; rechazada → dato inválido */
export type EstadoLecturaLocal = 'pendiente' | 'enviada' | 'conflicto' | 'rechazada';

export type LecturaLocal = {
  id: string; // uuid generado en el celular
  cuenta_id: string;
  periodo_id: string;
  operador_id: string;
  numero_cuenta: string;
  titular: string;
  lectura_anterior: number | null;
  lectura_actual: number | null;
  consumo: number | null;
  observacion: string | null;
  sin_lectura: boolean;
  fecha_lectura: string; // ISO, hora del celular
  estado: EstadoLecturaLocal;
  mensaje: string | null;
  enviada_at: string | null;
  intentos: number;
  // Ubicación y foto (lecturas cargadas antes de esta versión no las tienen)
  latitud?: number | null;
  longitud?: number | null;
  precision_gps?: number | null;
  tiene_foto?: boolean;
  tiene_audio?: boolean;
  /** true mientras falte subir la foto, la nota de voz o mandar la ubicación */
  extras_pendientes?: boolean;
};

/** Foto del medidor guardada en el celular hasta que se sube. */
export type FotoLocal = { lectura_id: string; blob: Blob; creada_at: string };

/** Nota de voz de la lectura, guardada en el celular hasta que se sube. */
export type AudioLocal = { lectura_id: string; blob: Blob; tipo: string; creada_at: string };

export type Meta =
  | { clave: 'descarga'; operador_id: string; periodo: Periodo | null; umbral: number; foto_obligatoria?: boolean; localidad?: string; fecha: string; cantidad: number }
  | { clave: 'sincronizacion'; fecha: string | null; error: string | null }
  | { clave: 'mensajes'; operador_id: string; lista: MensajeLocal[]; fecha: string };

/** Mensaje del administrador, guardado para verlo sin señal. */
export type MensajeLocal = { id: number; texto: string; created_at: string; para_todos: boolean };

export class BaseLocal extends Dexie {
  cuentas!: EntityTable<CuentaLocal, 'id'>;
  lecturas!: EntityTable<LecturaLocal, 'id'>;
  meta!: Table<Meta, string>;
  fotos!: EntityTable<FotoLocal, 'lectura_id'>;
  audios!: EntityTable<AudioLocal, 'lectura_id'>;

  constructor() {
    super('lecturas-medidores');
    this.version(1).stores({
      cuentas: 'id, numero_cuenta, medidor',
      lecturas: 'id, estado, operador_id, [periodo_id+cuenta_id], [operador_id+estado]',
      meta: 'clave',
    });
    this.version(2).stores({ fotos: 'lectura_id' });
    this.version(3).stores({ audios: 'lectura_id' });
  }
}

export const db = new BaseLocal();

export async function leerDescarga() {
  return (await db.meta.get('descarga')) as Extract<Meta, { clave: 'descarga' }> | undefined;
}
