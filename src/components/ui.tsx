import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  titulo,
  abierto,
  alCerrar,
  children,
  ancho = 'max-w-lg',
}: {
  titulo: string;
  abierto: boolean;
  alCerrar: () => void;
  children: ReactNode;
  ancho?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      className={`m-auto w-[calc(100%-2rem)] ${ancho} rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/40`}
    >
      {abierto && (
        <div className="flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold">{titulo}</h2>
            <button onClick={alCerrar} className="rounded-lg px-2 text-2xl leading-none text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
              ×
            </button>
          </header>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

type Tono = 'info' | 'exito' | 'alerta' | 'error';
const TONOS: Record<Tono, string> = {
  info: 'bg-sky-50 text-sky-900 border-sky-200',
  exito: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  alerta: 'bg-amber-50 text-amber-900 border-amber-200',
  error: 'bg-red-50 text-red-800 border-red-200',
};

export function Aviso({ tono = 'info', children, className = '' }: { tono?: Tono; children: ReactNode; className?: string }) {
  return (
    <div role={tono === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${TONOS[tono]} ${className}`}>
      {children}
    </div>
  );
}

const INSIGNIAS: Record<string, string> = {
  gris: 'bg-slate-100 text-slate-700',
  verde: 'bg-emerald-100 text-emerald-800',
  amarillo: 'bg-amber-100 text-amber-900',
  rojo: 'bg-red-100 text-red-800',
  azul: 'bg-sky-100 text-sky-800',
  violeta: 'bg-violet-100 text-violet-800',
};

export function Insignia({ color = 'gris', children }: { color?: keyof typeof INSIGNIAS; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${INSIGNIAS[color]}`}>{children}</span>;
}

export function BarraProgreso({ valor, total }: { valor: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-marca-600 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <p className="py-6 text-center text-sm text-slate-500">{texto}</p>;
}

export function Paginador({
  pagina,
  porPagina,
  total,
  alCambiar,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  alCambiar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-sm">
      <span className="text-slate-600">
        {pagina * porPagina + 1}–{Math.min(total, (pagina + 1) * porPagina)} de {total}
      </span>
      <div className="flex gap-2">
        <button className="boton-secundario min-h-9 px-3 text-sm" disabled={pagina === 0} onClick={() => alCambiar(pagina - 1)}>
          Anterior
        </button>
        <button className="boton-secundario min-h-9 px-3 text-sm" disabled={pagina + 1 >= paginas} onClick={() => alCambiar(pagina + 1)}>
          Siguiente
        </button>
      </div>
    </div>
  );
}

export function Encabezado({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{titulo}</h1>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}
