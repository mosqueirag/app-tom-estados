import { usePreferencias } from '@/lib/preferencias';

/** Modo oscuro y letra grande, guardados en este celular. */
export function PreferenciasPantalla() {
  const [prefs, cambiar] = usePreferencias();
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm" aria-label="Pantalla">
      <p className="font-semibold">Pantalla</p>
      <Interruptor texto="Modo oscuro" detalle="Cansa menos la vista de noche" activo={prefs.oscuro} alCambiar={(v) => cambiar({ oscuro: v })} />
      <Interruptor texto="Letra grande" detalle="Agranda todos los textos y botones" activo={prefs.letraGrande} alCambiar={(v) => cambiar({ letraGrande: v })} />
    </section>
  );
}

function Interruptor({ texto, detalle, activo, alCambiar }: { texto: string; detalle: string; activo: boolean; alCambiar: (v: boolean) => void }) {
  return (
    <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block font-medium">{texto}</span>
        <span className="block text-xs text-slate-500">{detalle}</span>
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={activo} onChange={(e) => alCambiar(e.target.checked)} aria-label={texto} />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-marca-600 peer-focus-visible:ring-2 peer-focus-visible:ring-marca-500 after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"
      />
    </label>
  );
}
