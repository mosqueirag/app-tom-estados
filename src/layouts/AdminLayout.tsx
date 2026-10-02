import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/contexto';
import { IndicadorConexion } from '@/components/IndicadorConexion';
import { CampanaAvisos, ProveedorAvisosLecturas } from '@/components/AvisosLecturas';
import { CalendarRange, ClipboardList, History, LayoutDashboard, LogOut, MapPinned, Route, Users, UserCog, type LucideIcon } from 'lucide-react';

const SECCIONES: { a: string; texto: string; Icono: LucideIcon; fin?: boolean }[] = [
  { a: '/admin', texto: 'Panel', Icono: LayoutDashboard, fin: true },
  { a: '/admin/cuentas', texto: 'Cuentas', Icono: Users },
  { a: '/admin/rutas', texto: 'Rutas', Icono: Route },
  { a: '/admin/lecturas', texto: 'Lecturas', Icono: ClipboardList },
  { a: '/admin/mapa', texto: 'Mapa', Icono: MapPinned },
  { a: '/admin/operadores', texto: 'Operadores', Icono: UserCog },
  { a: '/admin/periodos', texto: 'Períodos', Icono: CalendarRange },
  { a: '/admin/historial', texto: 'Historial', Icono: History },
];

export default function AdminLayout() {
  const auth = useAuth();
  const nombre = auth.estado === 'con_sesion' ? auth.perfil.nombre : '';

  return (
    <ProveedorAvisosLecturas>
    <div className="min-h-screen md:flex">
      <aside className="fondo-marca-suave border-b border-marca-100 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0 md:pb-36">
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/icons/icono.svg" alt="" className="size-9 shrink-0 drop-shadow" />
            <div className="min-w-0">
              <p className="texto-marca truncate font-bold leading-tight">Lecturas</p>
              <p className="truncate text-xs text-slate-500">Administración</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 md:flex-col md:items-end">
            <CampanaAvisos />
            <IndicadorConexion />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3" aria-label="Secciones">
          {SECCIONES.map((s) => (
            <NavLink
              key={s.a}
              to={s.a}
              end={s.fin}
              className={({ isActive }) =>
                `flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'fondo-marca shadow-sm shadow-marca-700/20' : 'text-slate-700 hover:bg-marca-100/60'
                }`
              }
            >
              <s.Icono className="size-4 shrink-0" aria-hidden="true" />
              {s.texto}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-marca-100 p-4 md:absolute md:inset-x-0 md:bottom-0 md:block">
          <img src="/logo/coopsar.svg" alt="COOPSAR" className="logo-coopsar mb-3 h-7 w-auto" />
          <p className="truncate text-sm font-medium">{nombre}</p>
          <button onClick={() => void auth.cerrarSesion()} className="mt-1 inline-flex items-center gap-1 text-sm text-marca-700 hover:underline">
            <LogOut className="size-4" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex-1">
        <div className="flex items-center justify-end gap-3 px-4 pt-3 md:hidden">
          <img src="/logo/coopsar.svg" alt="COOPSAR" className="logo-coopsar mr-auto h-6 w-auto" />
          <span className="truncate text-sm text-slate-600">{nombre}</span>
          <button onClick={() => void auth.cerrarSesion()} className="text-sm font-medium text-marca-700">
            Salir
          </button>
        </div>
        <main className="mx-auto max-w-6xl p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
    </ProveedorAvisosLecturas>
  );
}
