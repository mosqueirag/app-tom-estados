import { supabase } from './supabase';
import { traerTodo } from './consultas';
import { hoyISO } from './formato';

// Copia de seguridad manual: todas las tablas de la app en un Excel, una hoja
// por tabla, con los datos tal cual están en la base. Las fotos no entran
// (quedan en Supabase Storage).

const TABLAS = [
  ['cuentas', 'numero_cuenta'],
  ['periodos', 'fecha_inicio'],
  ['lecturas', 'fecha_lectura'],
  ['lecturas_conflictos', 'created_at'],
  ['lecturas_correcciones', 'corregida_at'],
  ['perfiles', 'nombre'],
  ['configuracion', 'id'],
] as const;

type Fila = Record<string, unknown>;

export async function descargarCopiaDeSeguridad(): Promise<Record<string, number>> {
  const [XLSX, ...datos] = await Promise.all([
    import('xlsx'),
    ...TABLAS.map(([tabla, orden]) =>
      traerTodo<Fila>((d, h) =>
        // Las tablas tienen tipos distintos; acá solo se copian las filas tal cual.
        supabase.from(tabla as 'cuentas').select('*').order(orden as 'numero_cuenta').range(d, h) as unknown as PromiseLike<{
          data: Fila[] | null;
          error: { message: string } | null;
        }>,
      ),
    ),
  ]);
  const libro = XLSX.utils.book_new();
  const cantidades: Record<string, number> = {};
  TABLAS.forEach(([tabla], i) => {
    const filas = datos[i].map((f) =>
      Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v])),
    );
    cantidades[tabla] = filas.length;
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas.length ? filas : [{ sin_datos: '' }]), tabla.slice(0, 31));
  });
  XLSX.writeFile(libro, `copia_lecturas_${hoyISO()}.xlsx`);
  return cantidades;
}
