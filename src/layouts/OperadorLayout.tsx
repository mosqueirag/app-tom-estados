import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/contexto';
import { EstadoSync } from '@/components/EstadoSync';
import { ProveedorSync } from '@/sync/ProveedorSync';
import { renovarPush } from '@/lib/push';

const PESTANIAS = [
  { a: '/operador', texto: 'Inicio', icono: '🏠', fin: true },
  { a: '/operador/recorrido', texto: 'Recorrido', icono: '🧭' },
  { a: '/operador/buscar', texto: 'Buscar', icono: '🔎' },
  { a: '/operador/mis-lecturas', texto: 'Mis lecturas', icono: '📋' },
  { a: '/operador/ayuda', texto: 'Ayuda', icono: '❔' },
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
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <img src="/logo/coopsar.svg" alt="COOPSAR" className="h-7 w-auto" />
        <EstadoSync />
      </header>

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
        className="fixed inset-x-0 bottom-0 z-10 mx-auto grid max-w-lg grid-cols-4 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
        aria-label="Navegación"
      >
        {PESTANIAS.map((p) => (
          <NavLink
            key={p.a}
            to={p.a}
            end={p.fin}
            className={({ isActive }) =>
              `flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                isActive ? 'text-marca-700' : 'text-slate-500'
              }`
            }
          >
            <span className="text-xl" aria-hidden>
              {p.icono}
            </span>
            {p.texto}
          </NavLink>
        ))}
      </nav>
    </div>
    </ProveedorSync>
  );
}
