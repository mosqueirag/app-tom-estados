const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
const fecha = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fechaHora = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23', // 14:35 y no 02:35 p. m.
});

export function fmtNumero(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : numero.format(Number(valor));
}

/** "2026-10-05" (fecha sin hora) → "05/10/2026" sin correr por zona horaria. */
export function fmtFecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  const [a, m, d] = valor.slice(0, 10).split('-').map(Number);
  return fecha.format(new Date(a, m - 1, d));
}

export function fmtFechaHora(valor: string | null | undefined): string {
  return valor ? fechaHora.format(new Date(valor)) : '—';
}

/**
 * Convierte un texto con número en formato argentino o internacional:
 * "1.234,5" → 1234.5 · "1234.5" → 1234.5 · "1234" → 1234. Devuelve null si no es número.
 */
export function parsearNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  let texto = valor.trim().replace(/\s/g, '');
  if (!texto) return null;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Nombre sugerido para un período: "Octubre 2026". */
export function nombrePeriodo(fechaBase = new Date()): string {
  return `${MESES[fechaBase.getMonth()]} ${fechaBase.getFullYear()}`;
}

export function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
