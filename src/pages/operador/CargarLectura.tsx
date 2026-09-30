import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CuentaLocal } from '@/lib/db';
import { fmtFecha, fmtFechaHora, fmtNumero } from '@/lib/formato';
import { guardarLecturaLocal } from '@/lib/sincronizacion';
import { nuevoUuid } from '@/lib/uuid';
import { OBSERVACIONES_RAPIDAS, validarLectura } from '@/lib/validarLectura';
import { useAuth } from '@/auth/contexto';
import { useSync } from '@/sync/contexto';
import { Aviso, Cargando } from '@/components/ui';

type Paso = 'cargar' | 'confirmar';

export default function CargarLectura() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const auth = useAuth();
  const sync = useSync();
  const operadorId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const periodo = sync.descarga?.periodo ?? null;
  const umbral = sync.descarga?.umbral ?? 3;

  const cuenta = useLiveQuery(() => db.cuentas.get(id), [id]);
  const previa = useLiveQuery(
    async () =>
      periodo
        ? (await db.lecturas.where({ periodo_id: periodo.id, cuenta_id: id }).filter((l) => l.operador_id === operadorId).first()) ?? null
        : null,
    [id, periodo?.id, operadorId],
  );

  const [paso, setPaso] = useState<Paso>('cargar');
  const [valor, setValor] = useState('');
  const [sinLectura, setSinLectura] = useState(false);
  const [observacion, setObservacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [revisoMenor, setRevisoMenor] = useState(false);
  const [revisoAnomalo, setRevisoAnomalo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [precargado, setPrecargado] = useState(false);

  // Si hay una lectura pendiente (sin enviar), se puede corregir: se precarga.
  useEffect(() => {
    if (previa && previa.estado === 'pendiente' && !precargado) {
      setValor(previa.lectura_actual === null ? '' : String(previa.lectura_actual).replace('.', ','));
      setSinLectura(previa.sin_lectura);
      setObservacion(previa.observacion ?? '');
      setPrecargado(true);
    }
  }, [previa, precargado]);

  if (cuenta === undefined || previa === undefined) return <Cargando />;
  if (!cuenta) return <Aviso tono="error">No se encontró la cuenta en el celular. Volvé a descargar las cuentas.</Aviso>;
  if (!periodo) return <Aviso tono="alerta">No hay un período abierto. Descargá las cuentas de nuevo cuando el administrador lo abra.</Aviso>;

  const anterior = cuenta.ultima_lectura === null ? null : Number(cuenta.ultima_lectura);
  const v = validarLectura(valor, sinLectura, anterior, cuenta.ultimo_consumo, umbral);

  // Ya leída en este período desde este celular (y enviada): no se duplica.
  if (previa && previa.estado !== 'pendiente') {
    return (
      <div className="space-y-4">
        <FichaCuenta cuenta={cuenta} />
        <Aviso tono={previa.estado === 'enviada' ? 'info' : 'alerta'}>
          <p className="font-semibold">Esta cuenta ya fue leída en este período desde este celular.</p>
          <p className="mt-1">
            Lectura: {previa.sin_lectura ? `sin lectura (${previa.observacion ?? 'sin observación'})` : fmtNumero(previa.lectura_actual)} ·{' '}
            {fmtFechaHora(previa.fecha_lectura)}
          </p>
          <p className="mt-1">
            {previa.estado === 'enviada' && 'Ya se envió. Si hay que corregirla, avisale al administrador.'}
            {previa.estado === 'conflicto' && (previa.mensaje ?? 'Otro operador ya la había leído. El administrador decide cuál queda.')}
            {previa.estado === 'rechazada' && (previa.mensaje ?? 'El servidor la rechazó. Avisale al administrador.')}
          </p>
        </Aviso>
        <Link to="/operador/buscar" className="boton-secundario w-full">
          Volver a buscar
        </Link>
      </div>
    );
  }

  function continuar() {
    if (v.error) {
      setError(v.error);
      return;
    }
    if (sinLectura && !observacion.trim()) {
      setError('Contá por qué no se pudo leer (elegí una opción o escribila).');
      return;
    }
    setError(null);
    setRevisoMenor(false);
    setRevisoAnomalo(false);
    setPaso('confirmar');
  }

  async function confirmar() {
    if (v.menorQueAnterior) {
      // Segunda confirmación, explícita
      if (!confirm(`¿Seguro? La lectura (${fmtNumero(v.valor)}) es MENOR que la anterior (${fmtNumero(anterior)}).\n\nConfirmá solo si es vuelta de medidor o cambio de medidor.`)) return;
    }
    setGuardando(true);
    try {
      await guardarLecturaLocal({
        id: previa?.id ?? nuevoUuid(),
        cuenta_id: cuenta!.id,
        periodo_id: periodo!.id,
        operador_id: operadorId,
        numero_cuenta: cuenta!.numero_cuenta,
        titular: cuenta!.titular,
        lectura_anterior: anterior,
        lectura_actual: sinLectura ? null : v.valor,
        consumo: sinLectura ? null : v.consumo,
        observacion: observacion.trim() || null,
        sin_lectura: sinLectura,
        fecha_lectura: new Date().toISOString(),
      });
      if (navigator.onLine) void sync.sincronizarAhora();
      navegar('/operador/buscar', { replace: true, state: { guardada: cuenta!.numero_cuenta } });
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  }

  if (paso === 'confirmar') {
    const puedeConfirmar = (!v.menorQueAnterior || revisoMenor) && (!v.consumoAnomalo || revisoAnomalo) && !guardando;
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Confirmar lectura</h1>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="font-bold">
            Cuenta {cuenta.numero_cuenta} · {cuenta.titular}
          </p>
          <p className="text-sm text-slate-600">
            {cuenta.direccion} · Medidor {cuenta.medidor}
          </p>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-2">
              <dt className="text-xs text-slate-500">Anterior</dt>
              <dd className="text-lg font-semibold tabular-nums">{fmtNumero(anterior)}</dd>
            </div>
            <div className="rounded-xl bg-marca-50 p-2">
              <dt className="text-xs text-slate-500">Actual</dt>
              <dd className="text-lg font-bold tabular-nums">{sinLectura ? '—' : fmtNumero(v.valor)}</dd>
            </div>
            <div className={`rounded-xl p-2 ${v.menorQueAnterior ? 'bg-red-50' : v.consumoAnomalo ? 'bg-amber-50' : 'bg-slate-50'}`}>
              <dt className="text-xs text-slate-500">Consumo</dt>
              <dd className="text-lg font-semibold tabular-nums">{sinLectura ? '—' : fmtNumero(v.consumo)}</dd>
            </div>
          </dl>
          {sinLectura && <p className="mt-3 text-sm">No se pudo leer: {observacion}</p>}
          {!sinLectura && observacion && <p className="mt-3 text-sm">Observación: {observacion}</p>}
        </div>

        {v.menorQueAnterior && (
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4">
            <p className="text-lg font-bold text-red-800">¿Vuelta de medidor o error?</p>
            <p className="mt-1 text-sm text-red-900">
              La lectura actual es menor que la anterior. Revisá el número en el medidor antes de confirmar.
            </p>
            <label className="mt-3 flex items-center gap-3 text-base">
              <input type="checkbox" className="size-6" checked={revisoMenor} onChange={(e) => setRevisoMenor(e.target.checked)} />
              Revisé el medidor y el número es correcto
            </label>
          </div>
        )}
        {v.consumoAnomalo && (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
            <p className="text-lg font-bold text-amber-900">Consumo muy alto</p>
            <p className="mt-1 text-sm text-amber-900">
              El consumo ({fmtNumero(v.consumo)}) es más de {fmtNumero(umbral)} veces el último ({fmtNumero(cuenta.ultimo_consumo)}).
            </p>
            <label className="mt-3 flex items-center gap-3 text-base">
              <input type="checkbox" className="size-6" checked={revisoAnomalo} onChange={(e) => setRevisoAnomalo(e.target.checked)} />
              Revisé el medidor y el número es correcto
            </label>
          </div>
        )}
        {error && <Aviso tono="error">{error}</Aviso>}

        <button className="boton-primario min-h-16 w-full text-lg" onClick={() => void confirmar()} disabled={!puedeConfirmar}>
          {guardando ? 'Guardando…' : 'Confirmar lectura'}
        </button>
        <button className="boton-secundario w-full" onClick={() => setPaso('cargar')}>
          Volver y corregir
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FichaCuenta cuenta={cuenta} />
      {previa?.estado === 'pendiente' && <Aviso>Ya cargaste esta cuenta y todavía no se envió: podés corregirla.</Aviso>}

      <label className="block">
        <span className="etiqueta text-base">Lectura actual</span>
        <input
          className="campo py-4 text-center text-3xl font-bold tabular-nums disabled:bg-slate-100"
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          value={sinLectura ? '' : valor}
          onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))}
          disabled={sinLectura}
          placeholder={sinLectura ? 'No se pudo leer' : '0'}
          autoFocus
        />
      </label>

      <label className="flex min-h-12 items-center gap-3 rounded-xl bg-white px-4 shadow-sm">
        <input type="checkbox" className="size-6" checked={sinLectura} onChange={(e) => setSinLectura(e.target.checked)} />
        <span className="text-base font-medium">No se pudo leer</span>
      </label>

      <div>
        <span className="etiqueta">Observación {sinLectura ? '(obligatoria)' : '(opcional)'}</span>
        <div className="mb-2 flex flex-wrap gap-2">
          {OBSERVACIONES_RAPIDAS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setObservacion(o)}
              className={`min-h-10 rounded-full border px-3 text-sm ${observacion === o ? 'border-marca-600 bg-marca-50 text-marca-800' : 'border-slate-300 bg-white'}`}
            >
              {o}
            </button>
          ))}
        </div>
        <input className="campo" value={observacion} onChange={(e) => setObservacion(e.target.value)} placeholder="Escribí una observación" aria-label="Observación" />
      </div>

      {error && <Aviso tono="error">{error}</Aviso>}

      <button className="boton-primario min-h-16 w-full text-lg" onClick={continuar}>
        Continuar
      </button>
      <Link to="/operador/buscar" className="boton-secundario w-full">
        Cancelar
      </Link>
    </div>
  );
}

function FichaCuenta({ cuenta }: { cuenta: CuentaLocal }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">Cuenta</p>
      <p className="text-2xl font-bold">{cuenta.numero_cuenta}</p>
      <p className="text-lg font-medium">{cuenta.titular}</p>
      <p className="text-slate-600">{cuenta.direccion}</p>
      <p className="text-slate-600">Medidor {cuenta.medidor}</p>
      <div className="mt-3 rounded-xl bg-slate-50 p-3">
        <p className="text-sm text-slate-500">Última lectura</p>
        <p className="text-2xl font-bold tabular-nums">{fmtNumero(cuenta.ultima_lectura)}</p>
        <p className="text-xs text-slate-500">
          {fmtFecha(cuenta.fecha_ultima_lectura)} · último consumo {fmtNumero(cuenta.ultimo_consumo)}
        </p>
      </div>
    </section>
  );
}
