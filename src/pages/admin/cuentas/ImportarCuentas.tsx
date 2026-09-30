import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError, traerTodo } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { descargarPlantillaCuentas, leerMatrizExcel } from '@/lib/excel';
import { validarCuentas, type CuentaExistente, type EstadoFila, type ResultadoValidacion } from '@/lib/importarCuentas';
import { Aviso, Insignia, Modal } from '@/components/ui';

const LOTE = 500;

const ETIQUETAS: Record<EstadoFila, { texto: string; color: 'verde' | 'azul' | 'gris' | 'amarillo' | 'rojo' }> = {
  nueva: { texto: 'Nueva', color: 'verde' },
  actualizar: { texto: 'Se actualiza', color: 'azul' },
  sin_cambios: { texto: 'Sin cambios', color: 'gris' },
  omitir: { texto: 'Se omite', color: 'amarillo' },
  error: { texto: 'Error', color: 'rojo' },
};

type Props = { abierto: boolean; periodoAbierto: string | null; alCerrar: () => void };

export function ImportarCuentas({ abierto, periodoAbierto, alCerrar }: Props) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [matriz, setMatriz] = useState<unknown[][] | null>(null);
  const [existentes, setExistentes] = useState<CuentaExistente[]>([]);
  const [actualizar, setActualizar] = useState(true);
  const [verEstado, setVerEstado] = useState<EstadoFila | 'todas'>('todas');
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) {
      setArchivo(null);
      setMatriz(null);
      setError(null);
      setResultado(null);
      setVerEstado('todas');
    }
  }, [abierto]);

  const validacion: ResultadoValidacion | null = useMemo(
    () => (matriz ? validarCuentas(matriz, existentes, { actualizarExistentes: actualizar, periodoAbierto: Boolean(periodoAbierto) }) : null),
    [matriz, existentes, actualizar, periodoAbierto],
  );

  async function elegirArchivo(f: File | undefined) {
    if (!f) return;
    setArchivo(f);
    setLeyendo(true);
    setError(null);
    setResultado(null);
    try {
      const [m, ex] = await Promise.all([
        leerMatrizExcel(f),
        traerTodo<CuentaExistente>((d, h) =>
          supabase.from('cuentas').select('id, numero_cuenta, titular, direccion, medidor, ultima_lectura, activa, ruta').order('numero_cuenta').range(d, h),
        ),
      ]);
      setMatriz(m);
      setExistentes(ex);
    } catch (e) {
      setMatriz(null);
      setError(e instanceof Error && /zip|file|format|Unsupported/i.test(e.message) ? 'No se pudo leer el archivo. ¿Es un Excel (.xlsx, .xls) o .csv?' : mensajeError(e));
    } finally {
      setLeyendo(false);
    }
  }

  async function importar() {
    if (!validacion) return;
    const nuevas = validacion.filas.filter((f) => f.estado === 'nueva');
    const aActualizar = validacion.filas.filter((f) => f.estado === 'actualizar');
    setImportando(true);
    setError(null);
    let creadas = 0;
    let actualizadas = 0;
    try {
      for (let i = 0; i < nuevas.length; i += LOTE) {
        const lote = nuevas.slice(i, i + LOTE).map((f) => ({
          numero_cuenta: f.numero_cuenta,
          titular: f.titular,
          direccion: f.direccion,
          medidor: f.medidor,
          ultima_lectura: f.ultima_lectura,
          ...(f.ruta !== null ? { ruta: f.ruta } : {}),
        }));
        const { error: err } = await supabase.from('cuentas').insert(lote);
        if (err) throw err;
        creadas += lote.length;
      }
      for (let i = 0; i < aActualizar.length; i += LOTE) {
        const lote = aActualizar.slice(i, i + LOTE).map((f) => ({
          numero_cuenta: f.numero_cuenta,
          titular: f.titular,
          direccion: f.direccion,
          medidor: f.medidor,
          ...(f.ruta !== null ? { ruta: f.ruta } : {}),
          activa: true,
          ...(periodoAbierto ? {} : { ultima_lectura: f.ultima_lectura }),
        }));
        const { error: err } = await supabase.from('cuentas').upsert(lote, { onConflict: 'numero_cuenta' });
        if (err) throw err;
        actualizadas += lote.length;
      }
      setResultado(`Listo: ${fmtNumero(creadas)} cuentas nuevas y ${fmtNumero(actualizadas)} actualizadas.`);
      setMatriz(null);
      setArchivo(null);
    } catch (e) {
      setError(`Se importaron ${creadas} nuevas y ${actualizadas} actualizadas, pero después falló: ${mensajeError(e)}`);
    } finally {
      setImportando(false);
    }
  }

  const filasVisibles = validacion?.filas.filter((f) => verEstado === 'todas' || f.estado === verEstado) ?? [];
  const aImportar = validacion ? validacion.resumen.nueva + validacion.resumen.actualizar : 0;

  return (
    <Modal titulo="Importar cuentas desde Excel" abierto={abierto} alCerrar={alCerrar} ancho="max-w-5xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          La primera fila del Excel debe tener las columnas <code>numero_cuenta, titular, direccion, medidor, ultima_lectura</code>, y opcionalmente <code>ruta</code>.{' '}
          <button className="text-marca-700 underline" onClick={() => void descargarPlantillaCuentas()}>
            Descargar plantilla vacía
          </button>
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <label className="boton-secundario cursor-pointer">
            {archivo ? 'Elegir otro archivo' : 'Elegir archivo'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="sr-only"
              onChange={(e) => {
                void elegirArchivo(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {archivo && <span className="text-sm text-slate-700">{archivo.name}</span>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} />
            Actualizar las cuentas que ya existen (por número de cuenta)
          </label>
        </div>

        {periodoAbierto && actualizar && (
          <Aviso tono="info">
            Hay un período abierto ({periodoAbierto}): en las cuentas existentes se actualizan titular, dirección y medidor, pero no la
            última lectura.
          </Aviso>
        )}
        {leyendo && <p className="text-sm text-slate-500">Leyendo archivo…</p>}
        {error && <Aviso tono="error">{error}</Aviso>}
        {resultado && <Aviso tono="exito">{resultado}</Aviso>}
        {validacion?.errorGeneral && <Aviso tono="error">{validacion.errorGeneral}</Aviso>}

        {validacion && !validacion.errorGeneral && (
          <>
            <div className="flex flex-wrap gap-2">
              <FiltroEstado activo={verEstado === 'todas'} onClick={() => setVerEstado('todas')}>
                Todas ({validacion.filas.length})
              </FiltroEstado>
              {(Object.keys(ETIQUETAS) as EstadoFila[]).map((e) =>
                validacion.resumen[e] ? (
                  <FiltroEstado key={e} activo={verEstado === e} onClick={() => setVerEstado(e)}>
                    {ETIQUETAS[e].texto} ({validacion.resumen[e]})
                  </FiltroEstado>
                ) : null,
              )}
            </div>

            <div className="max-h-[45vh] overflow-auto rounded-xl border border-slate-200">
              <table className="tabla">
                <thead className="sticky top-0">
                  <tr>
                    <th>Fila</th>
                    <th>Estado</th>
                    <th>N° cuenta</th>
                    <th>Titular</th>
                    <th>Dirección</th>
                    <th>Medidor</th>
                    <th>Ruta</th>
                    <th className="text-right">Última lectura</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {filasVisibles.slice(0, 500).map((f) => (
                    <tr key={f.fila} className={f.estado === 'error' ? 'bg-red-50' : ''}>
                      <td className="text-slate-500">{f.fila}</td>
                      <td>
                        <Insignia color={ETIQUETAS[f.estado].color}>{ETIQUETAS[f.estado].texto}</Insignia>
                      </td>
                      <td className="font-medium">{f.numero_cuenta}</td>
                      <td>{f.titular}</td>
                      <td>{f.direccion}</td>
                      <td>{f.medidor}</td>
                      <td className="whitespace-nowrap">{f.ruta ?? ''}</td>
                      <td className="text-right tabular-nums">{fmtNumero(f.ultima_lectura)}</td>
                      <td className="text-xs">
                        {f.errores.map((t) => (
                          <div key={t} className="text-red-700">{t}</div>
                        ))}
                        {f.cambios.length > 0 && <div className="text-sky-800">Cambia: {f.cambios.join(', ')}</div>}
                        {f.avisos.map((t) => (
                          <div key={t} className="text-amber-800">{t}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filasVisibles.length > 500 && <p className="p-2 text-center text-xs text-slate-500">Se muestran las primeras 500 filas.</p>}
            </div>

            {validacion.resumen.error > 0 && (
              <Aviso tono="alerta">
                {validacion.resumen.error} fila(s) tienen errores y no se van a importar. Podés corregir el Excel y volver a elegirlo, o
                importar solo las filas correctas.
              </Aviso>
            )}

            <div className="flex justify-end gap-2">
              <button className="boton-secundario" onClick={alCerrar}>
                Cancelar
              </button>
              <button className="boton-primario" disabled={!aImportar || importando} onClick={() => void importar()}>
                {importando ? 'Importando…' : `Importar ${aImportar} cuenta${aImportar === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function FiltroEstado({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-3 py-1 text-sm ${activo ? 'border-marca-600 bg-marca-50 text-marca-800' : 'border-slate-300 bg-white'}`}>
      {children}
    </button>
  );
}
