import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EstadoLecturaLocal } from '@/lib/db';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { useAuth } from '@/auth/contexto';
import { useSync } from '@/sync/contexto';
import { Aviso, Insignia } from '@/components/ui';

const ESTADOS: Record<EstadoLecturaLocal, { texto: string; color: 'verde' | 'azul' | 'amarillo' | 'rojo' }> = {
  enviada: { texto: 'Enviada', color: 'verde' },
  pendiente: { texto: 'Pendiente', color: 'azul' },
  conflicto: { texto: 'Con conflicto', color: 'amarillo' },
  rechazada: { texto: 'Rechazada', color: 'rojo' },
};

export default function MisLecturas() {
  const auth = useAuth();
  const sync = useSync();
  const [params, setParams] = useSearchParams();
  const filtro = (params.get('estado') as EstadoLecturaLocal | null) ?? null;
  const operadorId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const periodoId = sync.descarga?.periodo?.id;

  const lecturas = useLiveQuery(
    () => db.lecturas.where('operador_id').equals(operadorId).reverse().sortBy('fecha_lectura'),
    [operadorId],
  );
  const delPeriodo = (lecturas ?? []).filter((l) => l.periodo_id === periodoId);
  const deOtros = (lecturas ?? []).filter((l) => l.periodo_id !== periodoId && l.estado !== 'enviada');
  const lista = [...delPeriodo, ...deOtros].filter((l) => !filtro || l.estado === filtro);

  const cuenta = (e: EstadoLecturaLocal) => [...delPeriodo, ...deOtros].filter((l) => l.estado === e).length;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Mis lecturas {sync.descarga?.periodo ? `· ${sync.descarga.periodo.nombre}` : ''}</h1>
      <div className="flex flex-wrap gap-2">
        <Chip activo={!filtro} onClick={() => setParams({}, { replace: true })}>
          Todas ({delPeriodo.length + deOtros.length})
        </Chip>
        {(Object.keys(ESTADOS) as EstadoLecturaLocal[]).map((e) =>
          cuenta(e) ? (
            <Chip key={e} activo={filtro === e} onClick={() => setParams({ estado: e }, { replace: true })}>
              {ESTADOS[e].texto} ({cuenta(e)})
            </Chip>
          ) : null,
        )}
      </div>

      {sync.pendientes > 0 && (
        <button className="boton-secundario w-full" onClick={() => void sync.sincronizarAhora()} disabled={sync.sincronizando || !navigator.onLine}>
          {sync.sincronizando ? 'Enviando…' : `Enviar ${sync.pendientes} pendiente(s) ahora`}
        </button>
      )}

      {lista.length === 0 && <Aviso>Todavía no hay lecturas{filtro ? ' con ese estado' : ' en este período'}.</Aviso>}

      <ul className="space-y-2">
        {lista.map((l) => (
          <li key={l.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold">
                  {l.numero_cuenta} <span className="font-normal text-slate-600">· {l.titular}</span>
                </p>
                <p className="text-sm text-slate-600">
                  {l.sin_lectura ? 'Sin lectura' : `Lectura ${fmtNumero(l.lectura_actual)} · consumo ${fmtNumero(l.consumo)}`}
                  {l.observacion ? ` · ${l.observacion}` : ''}
                </p>
                <p className="text-xs text-slate-500">{fmtFechaHora(l.fecha_lectura)}</p>
                {l.periodo_id !== periodoId && <p className="text-xs text-amber-800">De un período anterior</p>}
              </div>
              <Insignia color={ESTADOS[l.estado].color}>{ESTADOS[l.estado].texto}</Insignia>
            </div>
            {l.mensaje && l.estado !== 'enviada' && <p className="mt-2 text-sm text-slate-700">{l.mensaje}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`min-h-10 rounded-full border px-3 text-sm ${activo ? 'border-marca-600 bg-marca-50 text-marca-800' : 'border-slate-300 bg-white'}`}>
      {children}
    </button>
  );
}
