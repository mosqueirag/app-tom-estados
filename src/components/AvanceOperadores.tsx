import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { traerTodo } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { useAlCambiarLecturas } from '@/components/AvisosLecturas';
import { MandarMensaje } from '@/components/MandarMensaje';
import { Aviso, Cargando, Tarjeta } from '@/components/ui';

type Fila = {
  id: string;
  nombre: string;
  hoy: number;
  sinLectura: number;
  primera: string | null;
  ultima: string | null;
  pendientes: number;
};

const hora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function haceCuanto(iso: string, ahora: number): string {
  const min = Math.floor((ahora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** Lecturas por hora: desde la primera lectura de hoy hasta la última (mínimo media hora). */
export function ritmoPorHora(cantidad: number, primera: string | null, ultima: string | null): number | null {
  if (!cantidad || !primera || !ultima) return null;
  const horas = Math.max(0.5, (new Date(ultima).getTime() - new Date(primera).getTime()) / 3600000);
  return Math.round((cantidad / horas) * 10) / 10;
}

/** Tablero de avance del día por operador, se actualiza solo con cada lectura que llega. */
export function AvanceOperadores({ periodoId }: { periodoId: string }) {
  const [ahora, setAhora] = useState(() => Date.now());
  const [mensajePara, setMensajePara] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const avance = useConsulta(async () => {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const [{ data: operadores, error: e1 }, hoy, pendientes] = await Promise.all([
      supabase.from('perfiles').select('id, nombre').eq('rol', 'operador').eq('activo', true).order('nombre'),
      traerTodo<{ operador_id: string; fecha_lectura: string; sin_lectura: boolean }>((d, h) =>
        supabase
          .from('lecturas')
          .select('operador_id, fecha_lectura, sin_lectura')
          .eq('periodo_id', periodoId)
          .gte('fecha_lectura', inicio.toISOString())
          .range(d, h),
      ),
      traerTodo<{ operador_id: string | null }>((d, h) =>
        supabase.rpc('cuentas_pendientes', { p_periodo_id: periodoId }).select('operador_id').range(d, h),
      ),
    ]);
    if (e1) throw e1;
    const filas = new Map<string, Fila>(
      (operadores ?? []).map((o) => [o.id, { id: o.id, nombre: o.nombre, hoy: 0, sinLectura: 0, primera: null, ultima: null, pendientes: 0 }]),
    );
    for (const l of hoy) {
      const f = filas.get(l.operador_id);
      if (!f) continue;
      f.hoy++;
      if (l.sin_lectura) f.sinLectura++;
      if (!f.primera || l.fecha_lectura < f.primera) f.primera = l.fecha_lectura;
      if (!f.ultima || l.fecha_lectura > f.ultima) f.ultima = l.fecha_lectura;
    }
    let sinAsignar = 0;
    for (const c of pendientes) {
      const f = c.operador_id ? filas.get(c.operador_id) : undefined;
      if (f) f.pendientes++;
      else sinAsignar++;
    }
    return { filas: [...filas.values()].sort((a, b) => b.hoy - a.hoy || a.nombre.localeCompare(b.nombre, 'es')), sinAsignar };
  }, [periodoId]);
  useAlCambiarLecturas(() => void avance.recargar());

  const filas = avance.datos?.filas ?? [];
  const totalHoy = filas.reduce((s, f) => s + f.hoy, 0);

  return (
    <Tarjeta className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Avance de hoy por operador</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{fmtNumero(totalHoy)} lecturas hoy</span>
          <button className="boton-chico" onClick={() => setMensajePara('')}>
            Mensaje a todos
          </button>
        </div>
      </div>
      {aviso && (
        <Aviso tono="exito" className="m-4">
          {aviso}
        </Aviso>
      )}
      {avance.error ? (
        <Aviso tono="error" className="m-4">
          {avance.error}
        </Aviso>
      ) : !avance.datos ? (
        <Cargando />
      ) : filas.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">No hay operadores activos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla" aria-label="Avance por operador">
            <thead>
              <tr>
                <th>Operador</th>
                <th className="text-right">Hoy</th>
                <th>Última lectura</th>
                <th className="text-right">Por hora</th>
                <th className="text-right">Pendientes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const ritmo = ritmoPorHora(f.hoy, f.primera, f.ultima);
                const quieto = f.ultima && ahora - new Date(f.ultima).getTime() > 60 * 60000;
                return (
                  <tr key={f.id}>
                    <td className="font-medium">{f.nombre}</td>
                    <td className="text-right tabular-nums">
                      {fmtNumero(f.hoy)}
                      {f.sinLectura > 0 && <span className="block text-xs text-slate-500">{f.sinLectura} sin lectura</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {f.ultima ? (
                        <>
                          {hora.format(new Date(f.ultima))}{' '}
                          <span className={`text-xs ${quieto ? 'font-medium text-amber-700' : 'text-slate-500'}`}>({haceCuanto(f.ultima, ahora)})</span>
                        </>
                      ) : (
                        <span className="text-slate-400">Sin lecturas hoy</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{ritmo === null ? '—' : fmtNumero(ritmo)}</td>
                    <td className="text-right tabular-nums">{fmtNumero(f.pendientes)}</td>
                    <td className="text-right">
                      <button className="boton-chico" onClick={() => setMensajePara(f.id)} aria-label={`Mensaje a ${f.nombre}`}>
                        Mensaje
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {avance.datos.sinAsignar > 0 && (
            <p className="px-4 py-2 text-xs text-slate-500">{fmtNumero(avance.datos.sinAsignar)} cuentas pendientes sin operador asignado.</p>
          )}
        </div>
      )}
      <MandarMensaje
        abierto={mensajePara !== null}
        para={mensajePara ?? ''}
        operadores={filas}
        alCerrar={() => setMensajePara(null)}
        alEnviar={(m) => {
          setMensajePara(null);
          setAviso(m);
        }}
      />
    </Tarjeta>
  );
}
