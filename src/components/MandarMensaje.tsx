import { useState, type FormEvent } from 'react';
import { llamarFuncion } from '@/lib/consultas';
import { Aviso, Modal } from '@/components/ui';

export type Destinatario = { id: string; nombre: string };

const RAPIDOS = ['Priorizar la Ruta ', 'Volver a la oficina', 'Revisar las lecturas con alerta', 'Sincronizar las lecturas pendientes'];

/** Aviso corto del admin a un operador o a todos: llega como notificación y queda en su Inicio. */
export function MandarMensaje({
  abierto,
  operadores,
  para: paraInicial = '',
  alCerrar,
  alEnviar,
}: {
  abierto: boolean;
  operadores: Destinatario[];
  para?: string;
  alCerrar: () => void;
  alEnviar: (m: string) => void;
}) {
  const [para, setPara] = useState(paraInicial);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [abiertoCon, setAbiertoCon] = useState<string | null>(null);

  // Al abrir, arrancar con el destinatario elegido
  const clave = abierto ? paraInicial || '*' : null;
  if (clave !== abiertoCon) {
    setAbiertoCon(clave);
    if (abierto) {
      setPara(paraInicial);
      setTexto('');
      setError(null);
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return setError('Escribí el mensaje.');
    setEnviando(true);
    setError(null);
    try {
      const r = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { mensaje: texto.trim(), para_id: para || null });
      alEnviar(r.mensaje);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Mensaje a operadores" abierto={abierto} alCerrar={alCerrar}>
      <form onSubmit={enviar} className="space-y-4">
        <label className="block">
          <span className="etiqueta">Para</span>
          <select className="campo" value={para} onChange={(e) => setPara(e.target.value)}>
            <option value="">Todos los operadores</option>
            {operadores.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="etiqueta">Mensaje</span>
          <textarea className="campo min-h-24" maxLength={500} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: Hoy priorizar la Ruta 2" />
          <span className="mt-1 block text-right text-xs text-slate-500">{texto.length}/500</span>
        </label>
        <div className="flex flex-wrap gap-1">
          {RAPIDOS.map((r) => (
            <button key={r} type="button" className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200" onClick={() => setTexto(r)}>
              {r.trim()}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">Le llega como notificación al celular y queda en la pantalla de Inicio de la app.</p>
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" className="boton-primario" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
