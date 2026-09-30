import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LecturaLocal } from '@/lib/db';
import { fmtNumero } from '@/lib/formato';

export type Resumen = { leidas: number; sinLectura: number; motivos: [string, number][]; pendientes: number; sinEnviar: number; total: number };

/** Cuentas del día a partir de lo guardado en el celular (anda sin señal). */
export function armarResumen(lecturasPeriodo: LecturaLocal[], totalCuentas: number, hoy = new Date()): Resumen {
  const inicio = new Date(hoy);
  inicio.setHours(0, 0, 0, 0);
  const deHoy = lecturasPeriodo.filter((l) => new Date(l.fecha_lectura) >= inicio && l.estado !== 'rechazada');
  const motivos = new Map<string, number>();
  for (const l of deHoy.filter((l) => l.sin_lectura)) {
    const m = (l.observacion ?? '').trim() || 'Sin motivo';
    motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  const leidasPeriodo = new Set(lecturasPeriodo.filter((l) => l.estado !== 'rechazada').map((l) => l.cuenta_id)).size;
  return {
    leidas: deHoy.filter((l) => !l.sin_lectura).length,
    sinLectura: deHoy.filter((l) => l.sin_lectura).length,
    motivos: [...motivos.entries()].sort((a, b) => b[1] - a[1]),
    pendientes: Math.max(0, totalCuentas - leidasPeriodo),
    sinEnviar: lecturasPeriodo.filter((l) => l.estado === 'pendiente').length,
    total: totalCuentas,
  };
}

export function textoResumen(r: Resumen, nombre: string): string {
  const fecha = new Date().toLocaleDateString('es-AR');
  return [
    `Resumen del ${fecha} · ${nombre}`,
    `Leídas: ${r.leidas}`,
    `Sin lectura: ${r.sinLectura}${r.motivos.length ? ` (${r.motivos.map(([m, n]) => `${m}: ${n}`).join(', ')})` : ''}`,
    `Pendientes del período: ${r.pendientes} de ${r.total}`,
    r.sinEnviar ? `Sin enviar todavía: ${r.sinEnviar}` : 'Todo enviado',
  ].join('\n');
}

export function ResumenDia({ operadorId, periodoId, nombre }: { operadorId: string; periodoId: string; nombre: string }) {
  const resumen = useLiveQuery(async () => {
    const [lecturas, total] = await Promise.all([
      db.lecturas.where('operador_id').equals(operadorId).filter((l) => l.periodo_id === periodoId).toArray(),
      db.cuentas.count(),
    ]);
    return armarResumen(lecturas, total);
  }, [operadorId, periodoId]);

  if (!resumen) return null;

  async function compartir() {
    const texto = textoResumen(resumen!, nombre);
    try {
      await navigator.share({ title: 'Resumen del día', text: texto });
    } catch {
      /* canceló o no se pudo: no pasa nada */
    }
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="Resumen del día">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">Resumen de hoy</p>
        {'share' in navigator && (
          <button className="text-sm text-marca-700 underline" onClick={() => void compartir()}>
            Compartir
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Numero valor={resumen.leidas} texto="leídas" color="text-emerald-800" />
        <Numero valor={resumen.sinLectura} texto="sin lectura" color="text-amber-800" />
        <Numero valor={resumen.pendientes} texto="pendientes" color="text-slate-800" />
      </div>
      {resumen.motivos.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {resumen.motivos.map(([motivo, n]) => (
            <li key={motivo} className="flex justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1 text-amber-900">
              <span>{motivo}</span>
              <strong>{n}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Pendientes: cuentas del período que todavía no leíste ({fmtNumero(resumen.total)} en total).
        {resumen.sinEnviar ? ` ${resumen.sinEnviar} sin enviar todavía.` : ''}
      </p>
    </section>
  );
}

function Numero({ valor, texto, color }: { valor: number; texto: string; color: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-2">
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{fmtNumero(valor)}</p>
      <p className="text-xs text-slate-600">{texto}</p>
    </div>
  );
}
