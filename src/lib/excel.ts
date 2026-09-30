// Lectura y escritura de Excel con SheetJS. Se carga bajo demanda para no
// agrandar la app del operador.
import type { CuentaExistente } from './importarCuentas';
import { COLUMNAS_CUENTAS, COLUMNAS_OPCIONALES } from './importarCuentas';
import type { Cuenta, VLectura } from '@/types/database';

const cargarXLSX = () => import('xlsx');

export async function leerMatrizExcel(archivo: File): Promise<unknown[][]> {
  const XLSX = await cargarXLSX();
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: '', raw: true, blankrows: false });
}

export async function descargarPlantillaCuentas(): Promise<void> {
  const XLSX = await cargarXLSX();
  const hoja = XLSX.utils.aoa_to_sheet([
    [...COLUMNAS_CUENTAS, ...COLUMNAS_OPCIONALES],
    ['10001', 'García, María', 'Av. San Martín 1250', 'MED-458721', 15230, 'Ruta 1'],
  ]);
  hoja['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Cuentas');
  XLSX.writeFile(libro, 'plantilla_cuentas.xlsx');
}

export async function exportarCuentas(cuentas: (Cuenta | CuentaExistente)[]): Promise<void> {
  const XLSX = await cargarXLSX();
  const hoja = XLSX.utils.json_to_sheet(
    cuentas.map((c) => ({
      numero_cuenta: c.numero_cuenta,
      titular: c.titular,
      direccion: c.direccion,
      medidor: c.medidor,
      ultima_lectura: c.ultima_lectura === null ? '' : Number(c.ultima_lectura),
      ruta: c.ruta ?? '',
      activa: c.activa ? 'Sí' : 'No',
    })),
  );
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Cuentas');
  XLSX.writeFile(libro, 'cuentas.xlsx');
}

const num = (v: number | null) => (v === null || v === undefined ? '' : Number(v));

export async function exportarLecturas(nombreArchivo: string, lecturas: VLectura[], pendientes: Cuenta[]): Promise<void> {
  const XLSX = await cargarXLSX();
  const libro = XLSX.utils.book_new();

  const hojaLecturas = XLSX.utils.json_to_sheet(
    lecturas.map((l) => ({
      'Período': l.periodo_nombre,
      'N° cuenta': l.numero_cuenta,
      'Titular': l.titular,
      'Dirección': l.direccion,
      'Medidor': l.medidor,
      'Ruta': l.ruta ?? '',
      'Lectura anterior': num(l.lectura_anterior),
      'Lectura actual': num(l.lectura_actual),
      'Consumo': num(l.consumo),
      'Sin lectura': l.sin_lectura ? 'Sí' : 'No',
      'Observación': l.observacion ?? '',
      'Operador': l.operador_nombre ?? '',
      'Fecha lectura': l.fecha_lectura ? new Date(l.fecha_lectura) : '',
      'Sincronizada': l.sincronizado_at ? new Date(l.sincronizado_at) : '',
      'Alerta': [
        l.alerta_menor_anterior && 'Menor a la anterior',
        l.alerta_consumo_anomalo && 'Consumo anómalo',
        l.alerta_sin_lectura && 'Sin lectura',
      ]
        .filter(Boolean)
        .join(', '),
      'Corregida por': l.corregida_por_nombre ?? '',
      'Corregida el': l.corregida_at ? new Date(l.corregida_at) : '',
    })),
    { cellDates: true, dateNF: 'dd/mm/yyyy hh:mm' },
  );
  hojaLecturas['!cols'] = [14, 12, 26, 28, 14, 12, 14, 14, 10, 10, 24, 18, 17, 17, 22, 18, 17].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(libro, hojaLecturas, 'Lecturas');

  if (pendientes.length) {
    const hojaPendientes = XLSX.utils.json_to_sheet(
      pendientes.map((c) => ({
        'N° cuenta': c.numero_cuenta,
        'Titular': c.titular,
        'Dirección': c.direccion,
        'Medidor': c.medidor,
        'Ruta': c.ruta ?? '',
        'Última lectura': num(c.ultima_lectura),
      })),
    );
    XLSX.utils.book_append_sheet(libro, hojaPendientes, 'Pendientes');
  }

  XLSX.writeFile(libro, nombreArchivo);
}
