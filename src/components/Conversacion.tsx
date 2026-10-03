import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { CheckCheck, Megaphone, SendHorizontal } from 'lucide-react';
import { enviarComoAdmin, enviarComoOperador, LARGO_MAXIMO, marcarLeidos, traerConversacion, useMensajesEnVivo } from '@/lib/chat';
import { mensajeError } from '@/lib/consultas';
import { fmtFechaHora } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { useConexion } from '@/hooks/useConexion';
import { Aviso, Cargando } from '@/components/ui';
import type { Mensaje } from '@/types/database';

type Props =
  | { modo: 'admin'; operadorId: string | null; nombre: string; alCambiar?: () => void }
  | { modo: 'operador'; operadorId: string; nombre?: string; alCambiar?: () => void };

/**
 * Conversación del chat interno.
 *   admin:    con un operador (o, con operadorId null, los mensajes para todos)
 *   operador: con la administración (incluye los mensajes para todos)
 */
export function Conversacion(props: Props) {
  const { modo, operadorId, alCambiar } = props;
  const enLinea = useConexion();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const fondo = useRef<HTMLDivElement>(null);

  const lista = useConsulta(() => traerConversacion(operadorId, modo === 'operador'), [operadorId, modo]);

  const propio = (m: Mensaje) => (modo === 'admin' ? m.autor_id !== m.para_id || m.para_id === null : m.autor_id === operadorId);
  const recibidosSinLeer = (lista.datos ?? []).some((m) => !propio(m) && m.para_id !== null && !m.leido_at);

  // Al ver la conversación, lo recibido queda leído
  useEffect(() => {
    if (!recibidosSinLeer || operadorId === null) return;
    void marcarLeidos(modo === 'admin' ? operadorId : undefined).then(() => alCambiar?.());
  }, [recibidosSinLeer, operadorId, modo, alCambiar]);

  useMensajesEnVivo(() => void lista.recargar());

  const cantidad = lista.datos?.length ?? 0;
  useEffect(() => {
    fondo.current?.scrollIntoView({ block: 'end' });
  }, [cantidad]);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setError(null);
    setNota(null);
    try {
      if (modo === 'admin') {
        const detalle = await enviarComoAdmin(operadorId, t);
        // Solo se muestra cuando el aviso al celular no llegó
        if (/no tiene|no están|No hay/.test(detalle)) setNota(detalle);
      } else {
        await enviarComoOperador(operadorId, t);
      }
      setTexto('');
      await lista.recargar();
      alCambiar?.();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && modo === 'admin') {
      e.preventDefault();
      void enviar();
    }
  }

  const otro = modo === 'admin' ? props.nombre : 'Administración';
  const ultimoPropio = [...(lista.datos ?? [])].reverse().find(propio);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" role="log" aria-label={`Conversación con ${otro}`} aria-live="polite">
        {lista.cargando && !lista.datos && <Cargando />}
        {lista.error && <Aviso tono="error">{enLinea ? lista.error : 'Sin señal: el chat necesita internet.'}</Aviso>}
        {lista.datos?.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            {operadorId === null ? 'Todavía no mandaste mensajes para todos.' : 'Todavía no hay mensajes. Escribí el primero.'}
          </p>
        )}
        {lista.datos?.map((m) => {
          const mio = propio(m);
          const general = m.para_id === null;
          return (
            <div key={m.id} className={`flex ${mio ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  mio ? 'fondo-marca rounded-br-md' : 'rounded-bl-md border border-slate-200 bg-white'
                }`}
              >
                {general && operadorId !== null && (
                  <p className={`mb-0.5 flex items-center gap-1 text-xs font-semibold ${mio ? 'text-white/80' : 'text-marca-700'}`}>
                    <Megaphone className="size-3.5" aria-hidden="true" /> Para todos
                  </p>
                )}
                <p className="whitespace-pre-line break-words">{m.texto}</p>
                <p className={`mt-0.5 flex items-center justify-end gap-1 text-[11px] ${mio ? 'text-white/75' : 'text-slate-500'}`}>
                  {fmtFechaHora(m.created_at)}
                  {mio && m === ultimoPropio && m.leido_at && !general && (
                    <span className="inline-flex items-center gap-0.5" title={`Visto ${fmtFechaHora(m.leido_at)}`}>
                      <CheckCheck className="size-3.5" aria-hidden="true" /> Visto
                    </span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={fondo} />
      </div>

      <form onSubmit={enviar} className="border-t border-slate-200 bg-white/90 p-3">
        {error && <Aviso tono="error" className="mb-2">{error}</Aviso>}
        {nota && <Aviso tono="alerta" className="mb-2">{nota}</Aviso>}
        <div className="flex items-end gap-2">
          <textarea
            className="campo max-h-32 min-h-12 flex-1 resize-none py-2.5"
            rows={1}
            maxLength={LARGO_MAXIMO}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={teclas}
            placeholder={enLinea ? (operadorId === null ? 'Mensaje para todos los operadores' : 'Escribí un mensaje') : 'Sin señal: el chat necesita internet'}
            aria-label="Escribir mensaje"
            disabled={!enLinea}
          />
          <button className="boton-primario size-12 shrink-0 px-0" disabled={!texto.trim() || enviando || !enLinea} aria-label="Enviar mensaje">
            <SendHorizontal className="size-5" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}
