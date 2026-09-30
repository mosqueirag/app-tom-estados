import { parsearNumero } from './formato';

export type Validacion = {
  valor: number | null;
  error: string | null;
  consumo: number | null;
  menorQueAnterior: boolean;
  consumoAnomalo: boolean;
};

/**
 * Valida la lectura que carga el operador.
 *  - número >= 0 (salvo "no se pudo leer")
 *  - menor que la anterior → advertencia (vuelta de medidor o error)
 *  - consumo > umbral × último consumo → advertencia
 */
export function validarLectura(
  texto: string,
  sinLectura: boolean,
  anterior: number | null,
  ultimoConsumo: number | null,
  umbral: number,
): Validacion {
  const base = { valor: null, consumo: null, menorQueAnterior: false, consumoAnomalo: false };
  if (sinLectura) return { ...base, error: null };
  if (!texto.trim()) return { ...base, error: 'Ingresá la lectura del medidor.' };
  const valor = parsearNumero(texto);
  if (valor === null) return { ...base, error: 'La lectura tiene que ser un número.' };
  if (valor < 0) return { ...base, error: 'La lectura no puede ser negativa.' };
  const consumo = anterior === null ? null : Math.round((valor - Number(anterior)) * 1000) / 1000;
  const menorQueAnterior = consumo !== null && consumo < 0;
  const consumoAnomalo =
    consumo !== null && !menorQueAnterior && ultimoConsumo !== null && Number(ultimoConsumo) > 0 && consumo > Number(ultimoConsumo) * umbral;
  return { valor, error: null, consumo, menorQueAnterior, consumoAnomalo };
}

export const OBSERVACIONES_RAPIDAS = ['Medidor inaccesible', 'Casa cerrada', 'Perro', 'Medidor roto', 'Medidor ilegible', 'Sin medidor'];
