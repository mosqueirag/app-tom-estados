import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { traerTodo } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Tarjeta } from '@/components/ui';
import type { Periodo } from '@/types/database';

type Totales = { consumo: number; lecturas: number };
export type FilaComparacion = { ruta: string; antes: Totales; ahora: Totales };

/** Consumo por ruta de un período frente a otro. */
export function compararPorRuta(
  ahora: { ruta: string; consumo: number | null }[],
  antes: { ruta: string; consumo: number | null }[],
): FilaComparacion[] {
  const filas = new Map<string, FilaComparacion>();
  const fila = (r: string) => {
    if (!filas.has(r)) filas.set(r, { ruta: r, antes: { consumo: 0, lecturas: 0 }, ahora: { consumo: 0, lecturas: 0 } });
    return filas.get(r)!;
  };
  for (const [lista, lado] of [[ahora, 'ahora'], [antes, 'antes']] as const) {
    for (const l of lista) {
      const t = fila(l.ruta ?? '')[lado];
      t.lecturas++;
      if (l.consumo !== null && Number(l.consumo) > 0) t.consumo += Number(l.consumo);
    }
  }
  return [...filas.values()].sort((a, b) => a.ruta.localeCompare(b.ruta, 'es', { numeric: true }));
}

export function variacion(antes: number, ahora: number): number | null {
  if (!antes) return null;
  return Math.round(((ahora - antes) / antes) * 1000) / 10;
}

const UMBRAL = 20; // % de variación que se marca

/** Compara el consumo total por ruta de un período con el anterior. */
export function ComparacionPeriodos({ periodos }: { periodos: Periodo[] }) {
  const ordenados = [...periodos].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio) || Number(b.activo) - Number(a.activo));
  const [elegido, setElegido] = useState('');
  const idAhora = elegido || ordenados[0]?.id || '';
  const indice = ordenados.findIndex((p) => p.id === idAhora);
  const [idAntes, setIdAntes] = useState('');
  const anterior = idAntes || ordenados[indice + 1]?.id || '';

  const datos = useConsulta(async () => {
    if (!idAhora || !anterior) return null;
    const traer = (id: string) =>
      traerTodo<{ ruta: string; consumo: number | null }>((d, h) => supabase.from('v_lecturas').select('ruta, consumo').eq('periodo_id', id).range(d, h));
    const [ahora, antes] = await Promise.all([traer(idAhora), traer(anterior)]);
    return compararPorRuta(ahora, antes);
  }, [idAhora, anterior]);

  if (ordenados.length < 2) return null;
  const nombre = (id: string) => ordenados.find((p) => p.id === id)?.nombre ?? '';
  const filas = datos.datos ?? [];
  const total = filas.reduce(
    (t, f) => ({ antes: t.antes + f.antes.consumo, ahora: t.ahora + f.ahora.consumo }),
    { antes: 0, ahora: 0 },
  );

  return (
    <Tarjeta className="mt-6 p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
        <h2 className="mr-auto font-semibold">Comparación de consumo por ruta</h2>
        <select
          className="campo w-auto"
          value={idAhora}
          onChange={(e) => {
            setElegido(e.target.value);
            setIdAntes('');
          }}
          aria-label="Período a comparar"
        >
          {ordenados.slice(0, -1).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">contra</span>
        <select className="campo w-auto" value={anterior} onChange={(e) => setIdAntes(e.target.value)} aria-label="Período anterior">
          {ordenados.slice(indice + 1).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </div>
      {datos.error ? (
        <Aviso tono="error" className="m-4">
          {datos.error}
        </Aviso>
      ) : datos.cargando && !datos.datos ? (
        <Cargando />
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla" aria-label="Comparación por ruta">
            <thead>
              <tr>
                <th>Ruta</th>
                <th className="text-right">{nombre(anterior)}</th>
                <th className="text-right">{nombre(idAhora)}</th>
                <th className="text-right">Diferencia</th>
                <th className="text-right">Variación</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <Fila key={f.ruta} ruta={f.ruta || 'Sin ruta'} antes={f.antes.consumo} ahora={f.ahora.consumo} detalle={`${f.antes.lecturas} / ${f.ahora.lecturas} lecturas`} />
              ))}
            </tbody>
            <tfoot>
              <Fila ruta="Total" antes={total.antes} ahora={total.ahora} negrita />
            </tfoot>
          </table>
          <p className="px-4 py-2 text-xs text-slate-500">
            Suma de consumos (sin contar las lecturas sin dato ni las negativas). Se marcan las rutas que cambiaron más de {UMBRAL}%. Si el período
            está abierto, todavía faltan lecturas.
          </p>
        </div>
      )}
    </Tarjeta>
  );
}

function Fila({ ruta, antes, ahora, detalle, negrita }: { ruta: string; antes: number; ahora: number; detalle?: string; negrita?: boolean }) {
  const v = variacion(antes, ahora);
  const marcar = v !== null && Math.abs(v) > UMBRAL;
  const dif = ahora - antes;
  return (
    <tr className={negrita ? 'font-semibold' : ''}>
      <td>
        {ruta}
        {detalle && <span className="block text-xs font-normal text-slate-500">{detalle}</span>}
      </td>
      <td className="text-right tabular-nums">{fmtNumero(antes)}</td>
      <td className="text-right tabular-nums">{fmtNumero(ahora)}</td>
      <td className="text-right tabular-nums">{dif > 0 ? `+${fmtNumero(dif)}` : fmtNumero(dif)}</td>
      <td className={`text-right tabular-nums ${marcar ? (v! > 0 ? 'font-semibold text-amber-700' : 'font-semibold text-sky-700') : ''}`}>
        {v === null ? '—' : `${v > 0 ? '+' : ''}${fmtNumero(v)}%`}
      </td>
    </tr>
  );
}
