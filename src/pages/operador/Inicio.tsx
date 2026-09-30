import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/contexto';
import { useConexion } from '@/hooks/useConexion';
import { esIOS, useSync } from '@/sync/contexto';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { mensajeError } from '@/lib/consultas';
import { Aviso } from '@/components/ui';
import { ActivarAvisos } from '@/components/ActivarAvisos';
import { MensajesOperador } from '@/components/MensajesOperador';
import { ResumenDia } from '@/components/ResumenDia';
import { PreferenciasPantalla } from '@/components/PreferenciasPantalla';

export default function InicioOperador() {
  const auth = useAuth();
  const enLinea = useConexion();
  const sync = useSync();
  const [mensaje, setMensaje] = useState<{ tono: 'exito' | 'error' | 'info'; texto: string } | null>(null);
  const nombre = auth.estado === 'con_sesion' ? auth.perfil.nombre : '';
  const periodo = sync.descarga?.periodo;
  const [params, setParams] = useSearchParams();
  const pedidoPorAviso = useRef(false);
  const [verMensajes] = useState(() => params.get('mensajes') === '1');

  async function descargar() {
    setMensaje(null);
    try {
      const r = await sync.descargar();
      setMensaje({
        tono: r.periodo ? 'exito' : 'info',
        texto: r.periodo
          ? `Listo: ${fmtNumero(r.cantidad)} cuentas guardadas en el celular para ${r.periodo}.`
          : `Se guardaron ${fmtNumero(r.cantidad)} cuentas, pero no hay un período abierto. Avisale al administrador.`,
      });
    } catch (e) {
      setMensaje({ tono: 'error', texto: `No se pudieron descargar las cuentas: ${mensajeError(e)}` });
    }
  }

  // Al tocar el aviso de un mensaje la app abre /operador?mensajes=1
  useEffect(() => {
    if (params.get('mensajes') === '1') setParams({}, { replace: true });
  }, [params, setParams]);

  // Al tocar el aviso de "cuentas nuevas" la app abre /operador?descargar=1: se descargan solas.
  useEffect(() => {
    if (params.get('descargar') !== '1' || pedidoPorAviso.current) return;
    pedidoPorAviso.current = true;
    setParams({}, { replace: true });
    if (enLinea) void descargar();
    else setMensaje({ tono: 'info', texto: 'Te asignaron cuentas nuevas. Cuando tengas señal, tocá "Descargar cuentas".' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function sincronizarAhora() {
    setMensaje(null);
    const r = await sync.sincronizarAhora();
    if (!r) return;
    if (r.error) setMensaje({ tono: 'error', texto: r.error });
    else if (r.enviadas + r.conflictos + r.rechazadas === 0) setMensaje({ tono: 'info', texto: 'No había lecturas para enviar.' });
    else
      setMensaje({
        tono: r.conflictos + r.rechazadas ? 'info' : 'exito',
        texto: `Enviadas: ${r.enviadas}.${r.conflictos ? ` Con conflicto: ${r.conflictos}.` : ''}${r.rechazadas ? ` Rechazadas: ${r.rechazadas}.` : ''}`,
      });
  }

  async function salir() {
    const aviso = sync.pendientes
      ? `Tenés ${sync.pendientes} lectura(s) sin enviar. Quedan guardadas en este celular y se envían cuando vuelvas a ingresar. ¿Cerrar sesión igual?`
      : '¿Cerrar sesión?';
    if (confirm(aviso)) await auth.cerrarSesion();
  }

  return (
    <div className="space-y-4">
      <section>
        <p className="text-sm text-slate-500">Hola,</p>
        <h1 className="text-2xl font-bold">{nombre}</h1>
      </section>

      <section className={`rounded-2xl p-4 ${enLinea ? 'bg-emerald-50' : 'bg-amber-50'}`}>
        <p className="font-semibold">{enLinea ? 'Con conexión' : 'Sin conexión'}</p>
        <p className="text-sm text-slate-700">
          {enLinea ? 'Las lecturas se envían solas.' : 'Podés seguir cargando lecturas: se guardan en el celular y se envían cuando vuelva la señal.'}
        </p>
      </section>

      <MensajesOperador resaltar={verMensajes} />

      <ActivarAvisos />

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Período</p>
        <p className="text-lg font-semibold">{periodo ? periodo.nombre : sync.descarga ? 'No hay período abierto' : 'Sin descargar'}</p>
        <p className="mt-1 text-sm text-slate-600">
          {sync.descarga
            ? `${fmtNumero(sync.descarga.cantidad)} cuentas · descargadas el ${fmtFechaHora(sync.descarga.fecha)}`
            : 'Descargá las cuentas antes de salir a leer (necesita internet).'}
        </p>
        <button className="boton-primario mt-3 w-full" onClick={() => void descargar()} disabled={!enLinea || sync.descargando}>
          {sync.descargando ? 'Descargando…' : 'Descargar cuentas'}
        </button>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-slate-500">Lecturas pendientes de envío</p>
          <p className="text-3xl font-bold tabular-nums">{sync.pendientes}</p>
        </div>
        {sync.conflictos > 0 && (
          <Link to="/operador/mis-lecturas?estado=conflicto" className="mt-1 block text-sm font-medium text-amber-800 underline">
            {sync.conflictos} con conflicto: ver
          </Link>
        )}
        {sync.rechazadas > 0 && (
          <Link to="/operador/mis-lecturas?estado=rechazada" className="mt-1 block text-sm font-medium text-red-700 underline">
            {sync.rechazadas} rechazada(s): ver
          </Link>
        )}
        <p className="mt-1 text-xs text-slate-500">
          Último envío: {sync.estadoGuardado?.fecha ? fmtFechaHora(sync.estadoGuardado.fecha) : 'nunca'}
          {sync.estadoGuardado?.error ? ` · ${sync.estadoGuardado.error}` : ''}
        </p>
        <button className="boton-secundario mt-3 w-full" onClick={() => void sincronizarAhora()} disabled={!enLinea || sync.sincronizando}>
          {sync.sincronizando ? 'Enviando…' : 'Sincronizar ahora'}
        </button>
      </section>

      {mensaje && <Aviso tono={mensaje.tono}>{mensaje.texto}</Aviso>}

      {periodo && auth.estado === 'con_sesion' && <ResumenDia operadorId={auth.perfil.id} periodoId={periodo.id} nombre={nombre} />}

      <Aviso tono={esIOS() ? 'alerta' : 'info'}>
        <strong>Importante:</strong> las lecturas se envían solo con la app abierta y con señal
        {esIOS() ? ' (el iPhone no permite enviar en segundo plano)' : ''}. Antes de terminar el día, abrí la app con señal y
        verificá que no queden pendientes.
      </Aviso>

      <Link to="/operador/buscar" className="boton-primario w-full">
        Buscar cuenta para leer
      </Link>
      <PreferenciasPantalla />

      <button onClick={() => void salir()} className="boton-secundario w-full">
        Cerrar sesión
      </button>
    </div>
  );
}
