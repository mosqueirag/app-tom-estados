import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useMensajesEnVivo } from '@/lib/chat';
import { fmtFechaHora } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado } from '@/components/ui';
import { Conversacion } from '@/components/Conversacion';

const TODOS = 'todos';

/** Chat interno: una conversación con cada operador y una para avisos a todos. */
export default function Mensajes() {
  const [params, setParams] = useSearchParams();
  const elegido = params.get('con');

  const conversaciones = useConsulta(async () => {
    const { data, error } = await supabase
      .from('v_conversaciones')
      .select('*')
      .order('ultimo_at', { ascending: false, nullsFirst: false })
      .order('nombre');
    if (error) throw error;
    return data;
  }, []);
  const recargar = useCallback(() => void conversaciones.recargar(), [conversaciones.recargar]); // eslint-disable-line react-hooks/exhaustive-deps
  useMensajesEnVivo(recargar);

  const lista = (conversaciones.datos ?? []).filter((c) => c.activo || c.ultimo_at);
  const actual = elegido && elegido !== TODOS ? lista.find((c) => c.operador_id === elegido) : null;
  const abrir = (id: string | null) => {
    const nuevos = new URLSearchParams(params);
    if (id) nuevos.set('con', id);
    else nuevos.delete('con');
    setParams(nuevos, { replace: !id });
  };

  return (
    <div>
      <Encabezado titulo="Mensajes" />
      {conversaciones.error && <Aviso tono="error" className="mb-4">{conversaciones.error}</Aviso>}
      <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:h-[calc(100vh-11rem)] md:grid-cols-[18rem_1fr]">
        <div role="group" aria-label="Conversaciones" className={`border-slate-200 md:block md:overflow-y-auto md:border-r ${elegido ? 'hidden' : ''}`}>
          <button
            type="button"
            onClick={() => abrir(TODOS)}
            className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-marca-50 ${elegido === TODOS ? 'bg-marca-50' : ''}`}
          >
            <span className="icono-marca size-10 shrink-0 rounded-full">
              <Megaphone className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium">Todos los operadores</span>
              <span className="block truncate text-xs text-slate-500">Avisos generales</span>
            </span>
          </button>
          {conversaciones.cargando && !conversaciones.datos && <Cargando />}
          {lista.map((c) => (
            <button
              key={c.operador_id}
              type="button"
              onClick={() => abrir(c.operador_id)}
              className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-marca-50 ${elegido === c.operador_id ? 'bg-marca-50' : ''}`}
              aria-label={`Conversación con ${c.nombre}${c.sin_leer ? `, ${c.sin_leer} sin leer` : ''}`}
            >
              <span className="fondo-marca flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold" aria-hidden="true">
                {iniciales(c.nombre)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${c.sin_leer ? 'font-bold' : 'font-medium'}`}>{c.nombre}</span>
                  {c.ultimo_at && <span className="shrink-0 text-[11px] text-slate-500">{fmtFechaHora(c.ultimo_at)}</span>}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-xs ${c.sin_leer ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
                    {c.ultimo_texto ? `${c.ultimo_del_operador ? '' : 'Vos: '}${c.ultimo_texto}` : 'Sin mensajes'}
                  </span>
                  {c.sin_leer > 0 && (
                    <span className="min-w-5 shrink-0 rounded-full bg-marca-600 px-1.5 text-center text-xs font-bold leading-5 text-white">{c.sin_leer}</span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>

        <section className={`min-h-[60vh] flex-col md:flex md:min-h-0 ${elegido ? 'flex' : 'hidden'}`} aria-label="Conversación">
          {elegido ? (
            <>
              <header className="fondo-marca-suave flex items-center gap-2 border-b border-slate-200 px-3 py-2">
                <button type="button" className="rounded-lg p-1.5 hover:bg-marca-100 md:hidden" onClick={() => abrir(null)} aria-label="Volver a las conversaciones">
                  <ArrowLeft className="size-5" aria-hidden="true" />
                </button>
                <h2 className="font-semibold">{elegido === TODOS ? 'Todos los operadores' : (actual?.nombre ?? 'Operador')}</h2>
              </header>
              <Conversacion
                key={elegido}
                modo="admin"
                operadorId={elegido === TODOS ? null : elegido}
                nombre={elegido === TODOS ? 'todos los operadores' : (actual?.nombre ?? 'el operador')}
                alCambiar={recargar}
              />
            </>
          ) : (
            <p className="m-auto p-8 text-center text-sm text-slate-500">Elegí un operador para ver la conversación.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
