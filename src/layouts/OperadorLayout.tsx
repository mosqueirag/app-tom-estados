import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/contexto';
import { EstadoSync } from '@/components/EstadoSync';
import { ProveedorSync } from '@/sync/ProveedorSync';
import { renovarPush } from '@/lib/push';
import { AvisoBateria } from '@/components/AvisoBateria';
import { CircleHelp, ClipboardList, Compass, House, Search, type LucideIcon } from 'lucide-react';

const PESTANIAS: { a: string; texto: string; Icono: LucideIcon; fin?: boolean }[] = [
  { a: '/operador', texto: 'Inicio', Icono: House, fin: true },
  { a: '/operador/recorrido', texto: 'Recorrido', Icono: Compass },
  { a: '/operador/buscar', texto: 'Buscar', Icono: Search },
  { a: '/operador/mis-lecturas', texto: 'Mis lecturas', Icono: ClipboardList },
  { a: '/operador/ayuda', texto: 'Ayuda', Icono: CircleHelp },
];

export default function OperadorLayout() {
  const auth = useAuth();
  const sinVerificar = auth.estado === 'con_sesion' && auth.sinVerificar;
  const operadorId = auth.estado === 'con_sesion' ? auth.perfil.id : '';

  // Si ya había activado los avisos, se vuelve a registrar el celular a su nombre.
  useEffect(() => {
    if (!operadorId || sinVerificar || !navigator.onLine) return;
    renovarPush().catch(() => undefined);
  }, [operadorId, sinVerificar]);

  return (
    <ProveedorSync operadorId={operadorId}>
    <div className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="fondo-marca sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 shadow-md shadow-marca-900/20">
        <div className="flex items-center gap-2">
          <img src="/icons/icono.svg" alt="" className="size-9 rounded-xl ring-2 ring-white/40" />
          <p className="text-lg font-bold">Lecturas</p>
        </div>
        <EstadoSync />
      </header>

      <AvisoBateria />

      {sinVerificar && (
        <p className="bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          Sin contacto con el servidor: trabajando con la sesión guardada en este celular.
        </p>
      )}

      <main className="flex-1 p-4 pb-28">
        <Outlet />
      </main>

      {/* Navegación inferior: botones grandes, al alcance del pulgar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-lg grid-cols-5 border-t border-marca-100 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(20_83_45/0.08)] backdrop-blur"
        aria-label="Navegación"
      >
        {PESTANIAS.map((p) => (
          <NavLink
            key={p.a}
            to={p.a}
            end={p.fin}
            className={({ isActive }) =>
              `group flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                isActive ? 'text-marca-700' : 'text-slate-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`flex h-8 w-12 items-center justify-center rounded-full transition ${isActive ? 'fondo-marca shadow-sm' : ''}`} aria-hidden>
                  <p.Icono className="size-5" strokeWidth={isActive ? 2.4 : 2} />
                </span>
                {p.texto}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
    </ProveedorSync>
  );
}
