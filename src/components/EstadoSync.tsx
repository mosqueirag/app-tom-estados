import { useConexion } from '@/hooks/useConexion';
import { useSync } from '@/sync/contexto';

/** Indicador siempre visible: "Sin conexión · 5 lecturas pendientes". */
export function EstadoSync() {
  const enLinea = useConexion();
  const { pendientes, sincronizando } = useSync();
  const texto = [
    enLinea ? 'En línea' : 'Sin conexión',
    sincronizando ? 'enviando…' : pendientes > 0 ? `${pendientes} ${pendientes === 1 ? 'lectura pendiente' : 'lecturas pendientes'}` : 'todo enviado',
  ].join(' · ');
  const color = !enLinea ? 'bg-amber-100 text-amber-900' : pendientes > 0 ? 'bg-sky-100 text-sky-900' : 'bg-emerald-100 text-emerald-800';
  const punto = !enLinea ? 'bg-amber-500' : pendientes > 0 ? 'bg-sky-500' : 'bg-emerald-500';
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
      <span className={`size-2 rounded-full ${punto} ${sincronizando ? 'animate-pulse' : ''}`} aria-hidden />
      {texto}
    </span>
  );
}
