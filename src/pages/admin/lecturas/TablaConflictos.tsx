import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/consultas';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Insignia, Tarjeta } from '@/components/ui';
import type { VConflicto } from '@/types/database';

const MOTIVOS: Record<VConflicto['motivo'], string> = {
  ya_leida: 'Otro operador ya había leído la cuenta',
  periodo_cerrado: 'Llegó después de cerrar el período',
  reemplazada: 'Lectura reemplazada por el administrador',
};

const valor = (sinLectura: boolean | null, lectura: number | null) => (sinLectura ? 'Sin lectura' : fmtNumero(lectura));

export function TablaConflictos({ periodoId, periodoActivo }: { periodoId: string; periodoActivo: boolean }) {
  const [verResueltos, setVerResueltos] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const lista = useConsulta(async () => {
    let c = supabase.from('v_conflictos').select('*').eq('periodo_id', periodoId);
    if (!verResueltos) c = c.eq('resuelto', false);
    const { data, error } = await c.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return data;
  }, [periodoId, verResueltos]);

  async function resolver(c: VConflicto, accion: 'descartar' | 'reemplazar') {
    const texto =
      accion === 'reemplazar'
        ? `¿Usar la lectura de ${c.operador_nombre} (${valor(c.sin_lectura, c.lectura_actual)}) en lugar de la actual (${valor(c.existente_sin_lectura, c.existente_lectura_actual)})?`
        : `¿Descartar la lectura de ${c.operador_nombre} y mantener la actual?`;
    if (!confirm(texto)) return;
    setTrabajando(c.id);
    const { error } = await supabase.rpc('resolver_conflicto', { p_conflicto_id: c.id, p_accion: accion });
    setTrabajando(null);
    if (error) setMensaje({ tono: 'error', texto: mensajeError(error) });
    else {
      setMensaje({ tono: 'exito', texto: `Conflicto de la cuenta ${c.numero_cuenta} resuelto.` });
      void lista.recargar();
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={verResueltos} onChange={(e) => setVerResueltos(e.target.checked)} />
        Mostrar también los resueltos
      </label>
      {mensaje && <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso>}
      {lista.error && <Aviso tono="error">{lista.error}</Aviso>}
      {lista.cargando && !lista.datos ? (
        <Cargando />
      ) : lista.datos?.length === 0 ? (
        <Tarjeta>
          <p className="text-slate-600">No hay conflictos {verResueltos ? '' : 'pendientes '}en este período.</p>
        </Tarjeta>
      ) : (
        lista.datos?.map((c) => (
          <Tarjeta key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  Cuenta {c.numero_cuenta} · {c.titular}
                </p>
                <p className="text-sm text-slate-600">{MOTIVOS[c.motivo]}</p>
              </div>
              {c.resuelto && <Insignia color={c.resolucion === 'reemplaza' ? 'verde' : 'gris'}>{c.resolucion === 'reemplaza' ? 'Se usó esta lectura' : 'Descartada'}</Insignia>}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="text-amber-900">Lectura en conflicto</p>
                <p className="text-xl font-semibold tabular-nums">{valor(c.sin_lectura, c.lectura_actual)}</p>
                <p className="text-slate-600">
                  {c.operador_nombre} · {fmtFechaHora(c.fecha_lectura)}
                </p>
                {c.observacion && <p className="text-slate-600">“{c.observacion}”</p>}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="text-slate-600">Lectura registrada</p>
                {c.existente_id ? (
                  <>
                    <p className="text-xl font-semibold tabular-nums">{valor(c.existente_sin_lectura, c.existente_lectura_actual)}</p>
                    <p className="text-slate-600">
                      {c.existente_operador_nombre} · {fmtFechaHora(c.existente_fecha_lectura)}
                    </p>
                    {c.existente_observacion && <p className="text-slate-600">“{c.existente_observacion}”</p>}
                  </>
                ) : (
                  <p className="text-slate-600">No hay lectura registrada para esta cuenta en el período.</p>
                )}
              </div>
            </div>
            {!c.resuelto && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button className="boton-secundario min-h-10" disabled={trabajando === c.id} onClick={() => void resolver(c, 'descartar')}>
                  {c.motivo === 'ya_leida' ? 'Mantener la registrada' : 'Marcar como revisado'}
                </button>
                {c.motivo === 'ya_leida' && periodoActivo && (
                  <button className="boton-primario min-h-10" disabled={trabajando === c.id} onClick={() => void resolver(c, 'reemplazar')}>
                    Usar esta lectura
                  </button>
                )}
              </div>
            )}
          </Tarjeta>
        ))
      )}
    </div>
  );
}
