import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/consultas';
import { fmtFecha, fmtNumero, hoyISO, nombrePeriodo } from '@/lib/formato';
import { usePeriodos } from '@/hooks/usePeriodos';
import { Aviso, Cargando, Encabezado, Insignia, Modal, Tarjeta } from '@/components/ui';
import type { Periodo, ResumenPeriodo } from '@/types/database';

type Mensaje = { tono: 'exito' | 'error'; texto: string };

export default function Periodos() {
  const periodos = usePeriodos();
  const [abriendo, setAbriendo] = useState(false);
  const [cerrando, setCerrando] = useState<Periodo | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const activo = periodos.datos?.find((p) => p.activo);

  return (
    <div>
      <Encabezado titulo="Períodos">
        <button className="boton-primario min-h-9 px-4 text-sm" disabled={!periodos.datos || Boolean(activo)} onClick={() => setAbriendo(true)}>
          Abrir nuevo período
        </button>
      </Encabezado>

      {mensaje && <Aviso tono={mensaje.tono} className="mb-4">{mensaje.texto}</Aviso>}
      {periodos.error && <Aviso tono="error" className="mb-4">{periodos.error}</Aviso>}

      {activo ? (
        <Tarjeta className="mb-4 border-marca-500">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">Período abierto</p>
              <h2 className="text-xl font-bold">{activo.nombre}</h2>
              <p className="text-sm text-slate-600">Desde el {fmtFecha(activo.fecha_inicio)}</p>
            </div>
            <button className="boton-peligro" onClick={() => setCerrando(activo)}>
              Cerrar período
            </button>
          </div>
        </Tarjeta>
      ) : (
        periodos.datos && (
          <Aviso tono="alerta" className="mb-4">
            No hay ningún período abierto: los operadores no pueden cargar lecturas.
          </Aviso>
        )
      )}

      <Tarjeta className="p-0">
        {periodos.cargando && !periodos.datos ? (
          <Cargando />
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Inicio</th>
                <th>Cierre</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {periodos.datos?.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.nombre}</td>
                  <td>{fmtFecha(p.fecha_inicio)}</td>
                  <td>{fmtFecha(p.fecha_cierre)}</td>
                  <td>{p.activo ? <Insignia color="verde">Abierto</Insignia> : <Insignia>Cerrado</Insignia>}</td>
                </tr>
              ))}
              {periodos.datos?.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    Todavía no hay períodos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Tarjeta>

      <AbrirPeriodo
        abierto={abriendo}
        alCerrar={() => setAbriendo(false)}
        alAbrir={(p) => {
          setAbriendo(false);
          setMensaje({ tono: 'exito', texto: `Se abrió el período ${p.nombre}. Los operadores tienen que volver a descargar las cuentas.` });
          void periodos.recargar();
        }}
      />
      <CerrarPeriodo
        periodo={cerrando}
        alCerrar={() => setCerrando(null)}
        alConfirmar={(r) => {
          setCerrando(null);
          setMensaje({
            tono: 'exito',
            texto: `Período ${r.nombre} cerrado. Se actualizó la última lectura de ${fmtNumero(r.cuentas_actualizadas ?? 0)} cuentas.`,
          });
          void periodos.recargar();
        }}
      />
    </div>
  );
}

function AbrirPeriodo({ abierto, alCerrar, alAbrir }: { abierto: boolean; alCerrar: () => void; alAbrir: (p: Periodo) => void }) {
  const [nombre, setNombre] = useState(nombrePeriodo());
  const [inicio, setInicio] = useState(hoyISO());
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function abrir(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('Poné un nombre, por ejemplo "Octubre 2026".');
      return;
    }
    setGuardando(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('abrir_periodo', { p_nombre: nombre.trim(), p_fecha_inicio: inicio });
    setGuardando(false);
    if (err) setError(mensajeError(err));
    else alAbrir(data as Periodo);
  }

  return (
    <Modal titulo="Abrir nuevo período" abierto={abierto} alCerrar={alCerrar}>
      <form onSubmit={abrir} className="space-y-4">
        <label className="block">
          <span className="etiqueta">Nombre</span>
          <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <label className="block">
          <span className="etiqueta">Fecha de inicio</span>
          <input className="campo" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </label>
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" className="boton-primario" disabled={guardando}>
            {guardando ? 'Abriendo…' : 'Abrir período'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CerrarPeriodo({
  periodo,
  alCerrar,
  alConfirmar,
}: {
  periodo: Periodo | null;
  alCerrar: () => void;
  alConfirmar: (r: ResumenPeriodo) => void;
}) {
  const [resumen, setResumen] = useState<ResumenPeriodo | null>(null);
  const [cargando, setCargando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idCargado, setIdCargado] = useState<string | null>(null);

  if (periodo && periodo.id !== idCargado) {
    setIdCargado(periodo.id);
    setResumen(null);
    setConfirmado(false);
    setError(null);
    setCargando(true);
    void supabase.rpc('resumen_periodo', { p_periodo_id: periodo.id }).then(({ data, error: err }) => {
      setCargando(false);
      if (err) setError(mensajeError(err));
      else setResumen(data as unknown as ResumenPeriodo);
    });
  }
  if (!periodo && idCargado) setIdCargado(null);

  async function cerrar() {
    if (!periodo) return;
    setCargando(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('cerrar_periodo', { p_periodo_id: periodo.id });
    setCargando(false);
    if (err) setError(mensajeError(err));
    else alConfirmar(data as unknown as ResumenPeriodo);
  }

  return (
    <Modal titulo={`Cerrar el período ${periodo?.nombre ?? ''}`} abierto={periodo !== null} alCerrar={alCerrar}>
      <div className="space-y-4">
        {!resumen && cargando && <Cargando texto="Calculando resumen…" />}
        {resumen && (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Fila titulo="Cuentas activas" valor={resumen.cuentas_activas} />
              <Fila titulo="Lecturas cargadas" valor={resumen.con_lectura} />
              <Fila titulo="Sin lectura" valor={resumen.sin_lectura} />
              <Fila titulo="Pendientes (sin visitar)" valor={resumen.pendientes} alerta={resumen.pendientes > 0} />
              <Fila titulo="Menores a la anterior" valor={resumen.alertas_menor_anterior} alerta={resumen.alertas_menor_anterior > 0} />
              <Fila titulo="Consumos anómalos" valor={resumen.alertas_consumo_anomalo} alerta={resumen.alertas_consumo_anomalo > 0} />
              <Fila titulo="Conflictos sin resolver" valor={resumen.conflictos_pendientes} alerta={resumen.conflictos_pendientes > 0} />
            </dl>
            <Aviso tono="alerta">
              Al cerrar, la lectura de cada cuenta leída pasa a ser su “última lectura” para el próximo período. Las cuentas pendientes
              o sin lectura conservan su lectura anterior. Los operadores ya no van a poder cargar lecturas en este período.
              {resumen.conflictos_pendientes > 0 && ' Los conflictos sin resolver ya no se van a poder resolver.'} Esta acción no se
              puede deshacer.
            </Aviso>
            {(resumen.pendientes > 0 || resumen.conflictos_pendientes > 0) && (
              <p className="text-sm text-slate-600">
                Sugerencia: antes de cerrar, pedí a los operadores que sincronicen todo lo que tengan pendiente en el celular.
              </p>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-5" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
              Revisé el resumen y quiero cerrar el período
            </label>
          </>
        )}
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="boton-peligro" disabled={!confirmado || cargando || !resumen} onClick={() => void cerrar()}>
            {cargando && resumen ? 'Cerrando…' : 'Cerrar período'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Fila({ titulo, valor, alerta = false }: { titulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${alerta ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <dt className="text-slate-600">{titulo}</dt>
      <dd className="text-lg font-semibold tabular-nums">{fmtNumero(valor)}</dd>
    </div>
  );
}
