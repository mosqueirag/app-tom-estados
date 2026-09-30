import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Cuenta, Periodo } from '@/types/database';

// Base de datos local del celular (IndexedDB). Todo lo que necesita el
// operador para trabajar sin señal vive acá.

export type CuentaLocal = Pick<
  Cuenta,
  'id' | 'numero_cuenta' | 'titular' | 'direccion' | 'medidor' | 'ultima_lectura' | 'fecha_ultima_lectura' | 'ultimo_consumo'
> & { ruta?: string }; // ruta puede faltar en cuentas descargadas antes de que existiera

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
};

export type Meta =
  | { clave: 'descarga'; operador_id: string; periodo: Periodo | null; umbral: number; fecha: string; cantidad: number }
  | { clave: 'sincronizacion'; fecha: string | null; error: string | null };

export class BaseLocal extends Dexie {
  cuentas!: EntityTable<CuentaLocal, 'id'>;
  lecturas!: EntityTable<LecturaLocal, 'id'>;
  meta!: Table<Meta, string>;

  constructor() {
    super('lecturas-medidores');
    this.version(1).stores({
      cuentas: 'id, numero_cuenta, medidor',
      lecturas: 'id, estado, operador_id, [periodo_id+cuenta_id], [operador_id+estado]',
      meta: 'clave',
    });
  }
}

export const db = new BaseLocal();

export async function leerDescarga() {
  return (await db.meta.get('descarga')) as Extract<Meta, { clave: 'descarga' }> | undefined;
}
