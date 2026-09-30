import { parsearNumero } from './formato';
import type { Cuenta } from '@/types/database';

export const COLUMNAS_CUENTAS = ['numero_cuenta', 'titular', 'direccion', 'medidor', 'ultima_lectura'] as const;
/** Columnas que pueden estar o no. Si falta "ruta", no se toca la ruta de las cuentas. */
export const COLUMNAS_OPCIONALES = ['ruta'] as const;

export type EstadoFila = 'nueva' | 'actualizar' | 'sin_cambios' | 'omitir' | 'error';

export type FilaImportada = {
  fila: number; // número de fila en el Excel (1 = encabezado)
  numero_cuenta: string;
  titular: string;
  direccion: string;
  medidor: string;
  ultima_lectura: number | null;
  ruta: string | null; // null = el Excel no tiene columna ruta
  estado: EstadoFila;
  errores: string[];
  avisos: string[];
  cambios: string[];
  existente?: Pick<Cuenta, 'id' | 'titular' | 'direccion' | 'medidor' | 'ultima_lectura' | 'activa' | 'ruta'>;
};

export type ResultadoValidacion = {
  filas: FilaImportada[];
  errorGeneral: string | null;
  resumen: Record<EstadoFila, number>;
};

export type CuentaExistente = Pick<Cuenta, 'id' | 'numero_cuenta' | 'titular' | 'direccion' | 'medidor' | 'ultima_lectura' | 'activa' | 'ruta'>;

function normalizarEncabezado(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_');
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return Number.isInteger(valor) ? String(valor) : String(valor);
  return String(valor).trim().replace(/\s+/g, ' ');
}

/**
 * Valida las filas leídas del Excel (matriz de celdas, la primera fila es el
 * encabezado) contra las cuentas que ya existen.
 *
 * @param actualizarExistentes si es false, las cuentas que ya existen se omiten
 * @param periodoAbierto con un período abierto no se cambia la última lectura
 *        de cuentas existentes (solo titular, dirección y medidor)
 */
export function validarCuentas(
  matriz: unknown[][],
  existentes: CuentaExistente[],
  { actualizarExistentes, periodoAbierto }: { actualizarExistentes: boolean; periodoAbierto: boolean },
): ResultadoValidacion {
  const resumen: Record<EstadoFila, number> = { nueva: 0, actualizar: 0, sin_cambios: 0, omitir: 0, error: 0 };
  const vacio = { filas: [], resumen };

  if (!matriz.length) return { ...vacio, errorGeneral: 'El archivo está vacío.' };

  const encabezado = matriz[0].map(normalizarEncabezado);
  const faltantes = COLUMNAS_CUENTAS.filter((c) => !encabezado.includes(c));
  if (faltantes.length) {
    return {
      ...vacio,
      errorGeneral: `Faltan columnas: ${faltantes.join(', ')}. La primera fila debe tener: ${COLUMNAS_CUENTAS.join(', ')}. Descargá la plantilla para ver el formato.`,
    };
  }
  const idx = Object.fromEntries(COLUMNAS_CUENTAS.map((c) => [c, encabezado.indexOf(c)])) as Record<(typeof COLUMNAS_CUENTAS)[number], number>;

  const idxRuta = encabezado.indexOf('ruta');
  const porNumero = new Map(existentes.map((c) => [c.numero_cuenta, c]));
  const vistos = new Map<string, number>();
  const filas: FilaImportada[] = [];

  matriz.slice(1).forEach((celdas, i) => {
    const valores = COLUMNAS_CUENTAS.map((c) => celdas?.[idx[c]]);
    if (valores.every((v) => texto(v) === '')) return; // fila vacía

    const fila: FilaImportada = {
      fila: i + 2,
      numero_cuenta: texto(celdas[idx.numero_cuenta]),
      titular: texto(celdas[idx.titular]),
      direccion: texto(celdas[idx.direccion]),
      medidor: texto(celdas[idx.medidor]),
      ultima_lectura: null,
      ruta: idxRuta >= 0 ? texto(celdas[idxRuta]) : null,
      estado: 'nueva',
      errores: [],
      avisos: [],
      cambios: [],
    };

    if (!fila.numero_cuenta) fila.errores.push('Falta el número de cuenta.');
    if (!fila.titular) fila.errores.push('Falta el titular.');
    if (!fila.direccion) fila.errores.push('Falta la dirección.');
    if (!fila.medidor) fila.errores.push('Falta el medidor.');

    const lecturaCruda = celdas[idx.ultima_lectura];
    if (texto(lecturaCruda) === '') {
      fila.errores.push('Falta la última lectura (poné 0 si el medidor es nuevo).');
    } else {
      const n = parsearNumero(lecturaCruda);
      if (n === null) fila.errores.push(`La última lectura "${texto(lecturaCruda)}" no es un número.`);
      else if (n < 0) fila.errores.push('La última lectura no puede ser negativa.');
      else fila.ultima_lectura = n;
    }

    if (fila.numero_cuenta) {
      const anterior = vistos.get(fila.numero_cuenta);
      if (anterior) fila.errores.push(`Número de cuenta repetido (también está en la fila ${anterior}).`);
      else vistos.set(fila.numero_cuenta, fila.fila);
    }

    const existente = porNumero.get(fila.numero_cuenta);
    if (fila.errores.length) {
      fila.estado = 'error';
    } else if (existente) {
      fila.existente = existente;
      if (!actualizarExistentes) {
        fila.estado = 'omitir';
        fila.avisos.push('La cuenta ya existe y no se va a modificar.');
      } else {
        if (existente.titular !== fila.titular) fila.cambios.push('titular');
        if (existente.direccion !== fila.direccion) fila.cambios.push('dirección');
        if (existente.medidor !== fila.medidor) fila.cambios.push('medidor');
        if (fila.ruta !== null && existente.ruta !== fila.ruta) fila.cambios.push('ruta');
        const cambiaLectura = Number(existente.ultima_lectura ?? NaN) !== fila.ultima_lectura;
        if (cambiaLectura && periodoAbierto) {
          fila.avisos.push('Hay un período abierto: la última lectura no se cambia.');
        } else if (cambiaLectura) {
          fila.cambios.push('última lectura');
        }
        if (!existente.activa) fila.cambios.push('se reactiva');
        fila.estado = fila.cambios.length ? 'actualizar' : 'sin_cambios';
      }
    }

    resumen[fila.estado]++;
    filas.push(fila);
  });

  if (!filas.length) return { ...vacio, errorGeneral: 'El archivo no tiene cuentas (solo el encabezado).' };
  return { filas, resumen, errorGeneral: null };
}
