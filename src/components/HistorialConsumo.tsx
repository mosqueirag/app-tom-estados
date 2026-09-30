import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/consultas';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { Aviso, Cargando, Modal } from '@/components/ui';

type Punto = {
  id: string;
  periodo_nombre: string;
  lectura_actual: number | null;
  consumo: number | null;
  sin_lectura: boolean;
  observacion: string | null;
  fecha_lectura: string;
  operador_nombre: string | null;
};

const PERIODOS = 12;

export type CuentaHistorial = { id: string; numero_cuenta: string; titular: string };

/** Consumo de los últimos períodos de una cuenta, con gráfico de barras. */
export function HistorialConsumo({ cuenta, alCerrar }: { cuenta: CuentaHistorial | null; alCerrar: () => void }) {
  const [puntos, setPuntos] = useState<Punto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPuntos(null);
    setError(null);
    if (!cuenta) return;
    let vigente = true;
    void supabase
      .from('v_lecturas')
      .select('id, periodo_nombre, lectura_actual, consumo, sin_lectura, observacion, fecha_lectura, operador_nombre')
      .eq('cuenta_id', cuenta.id)
      .order('fecha_lectura', { ascending: false })
      .limit(PERIODOS)
      .then(({ data, error: e }) => {
        if (!vigente) return;
        if (e) setError(mensajeError(e));
        else setPuntos(((data ?? []) as Punto[]).reverse());
      });
    return () => {
      vigente = false;
    };
  }, [cuenta]);

  const conConsumo = (puntos ?? []).filter((p) => p.consumo !== null && p.consumo >= 0);
  const promedio = conConsumo.length ? conConsumo.reduce((s, p) => s + Number(p.consumo), 0) / conConsumo.length : null;

  return (
    <Modal titulo={cuenta ? `Historial de consumo · ${cuenta.numero_cuenta}` : ''} abierto={cuenta !== null} alCerrar={alCerrar} ancho="max-w-3xl">
      {error ? (
        <Aviso tono="error">{error}</Aviso>
      ) : !puntos ? (
        <Cargando />
      ) : puntos.length === 0 ? (
        <p className="text-slate-600">Esta cuenta todavía no tiene lecturas cargadas.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {cuenta?.titular} · últimos {puntos.length} períodos
            {promedio !== null && (
              <>
                {' '}
                · consumo promedio <strong>{fmtNumero(Math.round(promedio * 10) / 10)}</strong>
              </>
            )}
          </p>
          <Grafico puntos={puntos} promedio={promedio} />
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="text-right">Lectura</th>
                  <th className="text-right">Consumo</th>
                  <th>Fecha</th>
                  <th>Operador</th>
                </tr>
              </thead>
              <tbody>
                {[...puntos].reverse().map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.periodo_nombre}</td>
                    <td className="text-right tabular-nums">{p.sin_lectura ? `Sin lectura${p.observacion ? `: ${p.observacion}` : ''}` : fmtNumero(p.lectura_actual)}</td>
                    <td className="text-right tabular-nums">{fmtNumero(p.consumo)}</td>
                    <td className="whitespace-nowrap">{fmtFechaHora(p.fecha_lectura)}</td>
                    <td>{p.operador_nombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Grafico({ puntos, promedio }: { puntos: Punto[]; promedio: number | null }) {
  const ANCHO = 640;
  const ALTO = 220;
  const MARGEN = { arriba: 16, abajo: 40, izq: 8, der: 8 };
  const maximo = Math.max(1, ...puntos.map((p) => Math.abs(Number(p.consumo ?? 0))), promedio ?? 0);
  const alto = ALTO - MARGEN.arriba - MARGEN.abajo;
  const paso = (ANCHO - MARGEN.izq - MARGEN.der) / puntos.length;
  const barra = Math.min(48, paso * 0.7);
  const y = (v: number) => MARGEN.arriba + alto - (v / maximo) * alto;

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full" role="img" aria-label="Gráfico de consumo por período">
      {puntos.map((p, i) => {
        const x = MARGEN.izq + i * paso + (paso - barra) / 2;
        const valor = p.consumo === null ? 0 : Math.max(0, Number(p.consumo));
        const alto2 = (valor / maximo) * alto;
        const raro = promedio !== null && p.consumo !== null && (p.consumo < 0 || (promedio > 0 && p.consumo > promedio * 2));
        return (
          <g key={p.id}>
            <title>{`${p.periodo_nombre}: ${p.sin_lectura ? 'sin lectura' : `consumo ${fmtNumero(p.consumo)}`}`}</title>
            {p.sin_lectura ? (
              <text x={x + barra / 2} y={MARGEN.arriba + alto - 4} textAnchor="middle" className="fill-slate-400" fontSize="11">
                s/l
              </text>
            ) : (
              <rect x={x} y={MARGEN.arriba + alto - alto2} width={barra} height={Math.max(1, alto2)} rx="4" className={raro ? 'fill-amber-500' : 'fill-marca-600'} />
            )}
            {!p.sin_lectura && (
              <text x={x + barra / 2} y={MARGEN.arriba + alto - alto2 - 4} textAnchor="middle" className="fill-slate-700" fontSize="11">
                {fmtNumero(p.consumo)}
              </text>
            )}
            <text x={x + barra / 2} y={ALTO - MARGEN.abajo + 16} textAnchor="middle" className="fill-slate-500" fontSize="11">
              {p.periodo_nombre.replace(/^(\w{3})\w*\s+\d{2}(\d{2})$/, '$1 $2')}
            </text>
          </g>
        );
      })}
      {promedio !== null && (
        <g>
          <line x1={MARGEN.izq} x2={ANCHO - MARGEN.der} y1={y(promedio)} y2={y(promedio)} className="stroke-slate-400" strokeDasharray="4 4" />
          <text x={ANCHO - MARGEN.der} y={y(promedio) - 4} textAnchor="end" className="fill-slate-500" fontSize="11">
            promedio
          </text>
        </g>
      )}
      <line x1={MARGEN.izq} x2={ANCHO - MARGEN.der} y1={MARGEN.arriba + alto} y2={MARGEN.arriba + alto} className="stroke-slate-300" />
    </svg>
  );
}
