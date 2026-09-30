import { useConexion } from '@/hooks/useConexion';

/** Pastilla "En línea" / "Sin conexión". En la Fase 4 suma las lecturas pendientes. */
export function IndicadorConexion({ className = '' }: { className?: string }) {
  const enLinea = useConexion();
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        enLinea ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
      } ${className}`}
    >
      <span className={`size-2 rounded-full ${enLinea ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
      {enLinea ? 'En línea' : 'Sin conexión'}
    </span>
  );
}
