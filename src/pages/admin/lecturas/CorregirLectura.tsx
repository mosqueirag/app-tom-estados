import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/consultas';
import { fmtFechaHora, fmtNumero, parsearNumero } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Modal } from '@/components/ui';
import type { LecturaCorreccion, VLectura } from '@/types/database';

type Props = { lectura: VLectura | null; editable: boolean; alCerrar: () => void; alGuardar: () => void };

export function CorregirLectura({ lectura, editable, alCerrar, alGuardar }: Props) {
  const [valor, setValor] = useState('');
  const [sinLectura, setSinLectura] = useState(false);
  const [observacion, setObservacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!lectura) return;
    setValor(lectura.lectura_actual === null ? '' : String(lectura.lectura_actual));
    setSinLectura(lectura.sin_lectura);
    setObservacion(lectura.observacion ?? '');
    setError(null);
  }, [lectura]);

  const historial = useConsulta(async () => {
    if (!lectura) return [] as (LecturaCorreccion & { autor: string | null })[];
    const { data, error } = await supabase
      .from('lecturas_correcciones')
      .select('*')
      .eq('lectura_id', lectura.id)
      .order('corregida_at', { ascending: false });
    if (error) throw error;
    const ids = [...new Set(data.map((c) => c.corregida_por).filter(Boolean))] as string[];
    const { data: perfiles } = ids.length ? await supabase.from('perfiles').select('id, nombre').in('id', ids) : { data: [] };
    const nombres = new Map((perfiles ?? []).map((p) => [p.id, p.nombre]));
    return data.map((c) => ({ ...c, autor: c.corregida_por ? nombres.get(c.corregida_por) ?? null : null }));
  }, [lectura?.id]);

  const numero = parsearNumero(valor);
  const consumo = !sinLectura && numero !== null && lectura?.lectura_anterior != null ? numero - Number(lectura.lectura_anterior) : null;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!lectura) return;
    if (!sinLectura && (numero === null || numero < 0)) {
      setError('La lectura debe ser un número mayor o igual a 0.');
      return;
    }
    if (consumo !== null && consumo < 0 && !confirm('La lectura es menor que la anterior. ¿Vuelta de medidor o error? ¿Guardar igual?')) return;
    setGuardando(true);
    setError(null);
    const { error: err } = await supabase
      .from('lecturas')
      .update({ lectura_actual: sinLectura ? null : numero, sin_lectura: sinLectura, observacion: observacion.trim() || null })
      .eq('id', lectura.id);
    setGuardando(false);
    if (err) setError(mensajeError(err));
    else alGuardar();
  }

  return (
    <Modal titulo={lectura ? `Lectura de la cuenta ${lectura.numero_cuenta}` : ''} abierto={lectura !== null} alCerrar={alCerrar}>
      {lectura && (
        <form onSubmit={guardar} className="space-y-4">
          <div className="text-sm text-slate-600">
            <p>
              <strong>{lectura.titular}</strong> · {lectura.direccion}
            </p>
            <p>
              Medidor {lectura.medidor} · Cargada por {lectura.operador_nombre} el {fmtFechaHora(lectura.fecha_lectura)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
            <div>
              <p className="text-slate-500">Lectura anterior</p>
              <p className="text-lg font-semibold tabular-nums">{fmtNumero(lectura.lectura_anterior)}</p>
            </div>
            <div>
              <p className="text-slate-500">Consumo</p>
              <p className={`text-lg font-semibold tabular-nums ${consumo !== null && consumo < 0 ? 'text-red-700' : ''}`}>{fmtNumero(consumo)}</p>
            </div>
          </div>

          <label className="block">
            <span className="etiqueta">Lectura actual</span>
            <input
              className="campo disabled:bg-slate-100"
              inputMode="decimal"
              value={sinLectura ? '' : valor}
              onChange={(e) => setValor(e.target.value)}
              disabled={!editable || sinLectura}
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-5" checked={sinLectura} onChange={(e) => setSinLectura(e.target.checked)} disabled={!editable} />
            No se pudo leer
          </label>
          <label className="block">
            <span className="etiqueta">Observación</span>
            <input className="campo disabled:bg-slate-100" value={observacion} onChange={(e) => setObservacion(e.target.value)} disabled={!editable} />
          </label>

          {!editable && <Aviso>El período está cerrado: la lectura ya no se puede corregir.</Aviso>}
          {error && <Aviso tono="error">{error}</Aviso>}

          {historial.datos && historial.datos.length > 0 && (
            <div>
              <p className="etiqueta">Historial de correcciones</p>
              <ul className="space-y-1 text-sm text-slate-600">
                {historial.datos.map((c) => (
                  <li key={c.id}>
                    {fmtFechaHora(c.corregida_at)} · {c.autor ?? 'Admin'}: {c.sin_lectura_anterior ? 'sin lectura' : fmtNumero(c.lectura_actual_anterior)} →{' '}
                    {c.sin_lectura_nueva ? 'sin lectura' : fmtNumero(c.lectura_actual_nueva)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="boton-secundario" onClick={alCerrar}>
              {editable ? 'Cancelar' : 'Cerrar'}
            </button>
            {editable && (
              <button type="submit" className="boton-primario" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar corrección'}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
