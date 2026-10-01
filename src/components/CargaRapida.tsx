import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/consultas';
import { fmtNumero, parsearNumero } from '@/lib/formato';
import { useAuth } from '@/auth/contexto';
import { useDemorado } from '@/hooks/useConsulta';
import { Aviso, Tarjeta } from '@/components/ui';

type CuentaEncontrada = {
  id: string;
  numero_cuenta: string;
  titular: string;
  direccion: string;
  ultima_lectura: number | null;
  activa: boolean;
  yaLeida: number | null | 'sin_lectura';
};

type Cargada = { numero: string; titular: string; texto: string; alerta: boolean };

/**
 * Carga rápida de lecturas desde el Panel: número de cuenta → Enter → lectura → Enter.
 * La lectura queda a nombre del admin, como si la hubiera tomado un operador.
 */
export function CargaRapida({ periodoId, alGuardar }: { periodoId: string; alGuardar: () => void }) {
  const auth = useAuth();
  const miId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const [numero, setNumero] = useState('');
  const [lectura, setLectura] = useState('');
  const [sinLectura, setSinLectura] = useState(false);
  const [observacion, setObservacion] = useState('');
  const [cuenta, setCuenta] = useState<CuentaEncontrada | null | 'no_existe'>(null);
  const [buscando, setBuscando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargadas, setCargadas] = useState<Cargada[]>([]);
  // Sube con cada lectura guardada, para volver a consultar la cuenta aunque se repita el número
  const [version, setVersion] = useState(0);
  const campoNumero = useRef<HTMLInputElement>(null);
  const campoLectura = useRef<HTMLInputElement>(null);

  const buscado = useDemorado(numero.trim(), 250);
  useEffect(() => {
    let vigente = true;
    setCuenta(null);
    if (!buscado) return;
    setBuscando(true);
    void (async () => {
      const { data, error: e1 } = await supabase
        .from('cuentas')
        .select('id, numero_cuenta, titular, direccion, ultima_lectura, activa')
        .eq('numero_cuenta', buscado)
        .maybeSingle();
      let yaLeida: CuentaEncontrada['yaLeida'] = null;
      if (data) {
        const { data: l } = await supabase
          .from('lecturas')
          .select('lectura_actual, sin_lectura')
          .eq('cuenta_id', data.id)
          .eq('periodo_id', periodoId)
          .maybeSingle();
        if (l) yaLeida = l.sin_lectura ? 'sin_lectura' : l.lectura_actual;
      }
      if (!vigente) return;
      setBuscando(false);
      if (e1) setError(mensajeError(e1));
      else setCuenta(data ? { ...data, yaLeida: yaLeida === undefined ? null : yaLeida } : 'no_existe');
    })();
    return () => {
      vigente = false;
    };
  }, [buscado, periodoId, version]);

  const encontrada = cuenta && cuenta !== 'no_existe' ? cuenta : null;
  const yaTiene = encontrada !== null && encontrada.yaLeida !== null;
  const valor = parsearNumero(lectura);
  const puedeGuardar =
    !!encontrada && encontrada.activa && !yaTiene && buscado === numero.trim() && (sinLectura ? true : valor !== null && valor >= 0);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!encontrada) {
      campoNumero.current?.focus();
      return;
    }
    if (!puedeGuardar) {
      if (!sinLectura && (valor === null || valor < 0)) setError('Ingresá la lectura del medidor (un número).');
      return;
    }
    setGuardando(true);
    const { error: e1 } = await supabase.from('lecturas').insert({
      id: crypto.randomUUID(),
      cuenta_id: encontrada.id,
      periodo_id: periodoId,
      operador_id: miId,
      lectura_actual: sinLectura ? null : valor,
      sin_lectura: sinLectura,
      observacion: observacion.trim() || null,
      fecha_lectura: new Date().toISOString(),
    });
    setGuardando(false);
    if (e1) {
      setError(e1.code === '23505' ? 'Esa cuenta ya tiene lectura en este período. Corregila en Lecturas.' : mensajeError(e1));
      return;
    }
    const anterior = encontrada.ultima_lectura;
    const consumo = !sinLectura && valor !== null && anterior !== null ? valor - anterior : null;
    setCargadas((antes) =>
      [
        {
          numero: encontrada.numero_cuenta,
          titular: encontrada.titular,
          texto: sinLectura
            ? `sin lectura${observacion.trim() ? `: ${observacion.trim()}` : ''}`
            : `${fmtNumero(valor)}${consumo !== null ? ` · consumo ${fmtNumero(consumo)}` : ''}`,
          alerta: consumo !== null && consumo < 0,
        },
        ...antes,
      ].slice(0, 8),
    );
    setNumero('');
    setLectura('');
    setObservacion('');
    setSinLectura(false);
    setVersion((v) => v + 1);
    alGuardar();
    campoNumero.current?.focus();
  }

  return (
    <Tarjeta>
      <h2 className="font-semibold" id="carga-rapida">
        Carga rápida de lecturas
      </h2>
      <p className="mt-1 text-sm text-slate-600">Escribí el número de cuenta, Enter, la lectura y Enter. Queda guardada a tu nombre.</p>
      <form onSubmit={guardar} className="mt-3 space-y-3" aria-labelledby="carga-rapida">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="etiqueta">N° de cuenta</span>
            <input
              ref={campoNumero}
              className="campo w-36"
              inputMode="numeric"
              autoComplete="off"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (numero.trim()) campoLectura.current?.focus();
                }
              }}
              aria-label="Número de cuenta para carga rápida"
            />
          </label>
          <label>
            <span className="etiqueta">Lectura</span>
            <input
              ref={campoLectura}
              className="campo w-36"
              inputMode="decimal"
              autoComplete="off"
              value={lectura}
              disabled={sinLectura}
              onChange={(e) => setLectura(e.target.value)}
              aria-label="Lectura para carga rápida"
            />
          </label>
          <button className="boton-primario" disabled={guardando || !puedeGuardar}>
            {guardando ? 'Guardando…' : 'Guardar lectura'}
          </button>
        </div>

        <div className="min-h-6 text-sm" aria-live="polite">
          {buscando && <span className="text-slate-500">Buscando…</span>}
          {!buscando && cuenta === 'no_existe' && <span className="text-red-700">No existe la cuenta {buscado}.</span>}
          {!buscando && encontrada && (
            <span>
              <strong>{encontrada.titular}</strong>
              {encontrada.direccion ? ` · ${encontrada.direccion}` : ''} · anterior {fmtNumero(encontrada.ultima_lectura)}
              {!encontrada.activa && <span className="ml-2 text-red-700">La cuenta está dada de baja.</span>}
              {yaTiene && (
                <span className="ml-2 text-amber-700">
                  Ya tiene lectura en este período ({encontrada.yaLeida === 'sin_lectura' ? 'sin lectura' : fmtNumero(encontrada.yaLeida as number)}).
                </span>
              )}
              {!sinLectura && valor !== null && encontrada.ultima_lectura !== null && valor < encontrada.ultima_lectura && (
                <span className="ml-2 text-amber-700">Es menor a la anterior.</span>
              )}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={sinLectura} onChange={(e) => setSinLectura(e.target.checked)} />
            No se pudo leer
          </label>
          <input
            className="campo max-w-xs flex-1 py-2 text-sm"
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            placeholder={sinLectura ? 'Motivo (ej. medidor tapado)' : 'Observación (opcional)'}
            aria-label="Observación para carga rápida"
          />
        </div>
      </form>

      {error && (
        <Aviso tono="error" className="mt-3">
          {error}
        </Aviso>
      )}

      {cargadas.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm" aria-label="Lecturas cargadas recién">
          {cargadas.map((c, i) => (
            <li key={`${c.numero}-${i}`} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span>
                ✓ <strong>{c.numero}</strong> · {c.titular}
              </span>
              <span className={c.alerta ? 'text-amber-700' : 'text-slate-600'}>{c.texto}</span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
