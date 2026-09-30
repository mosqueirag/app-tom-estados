import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/contexto';
import { IndicadorConexion } from '@/components/IndicadorConexion';
import { CampanaAvisos, ProveedorAvisosLecturas } from '@/components/AvisosLecturas';

const SECCIONES = [
  { a: '/admin', texto: 'Panel', fin: true },
  { a: '/admin/cuentas', texto: 'Cuentas' },
  { a: '/admin/rutas', texto: 'Rutas' },
  { a: '/admin/lecturas', texto: 'Lecturas' },
  { a: '/admin/mapa', texto: 'Mapa' },
  { a: '/admin/operadores', texto: 'Operadores' },
  { a: '/admin/periodos', texto: 'Períodos' },
  { a: '/admin/historial', texto: 'Historial' },
];

export default function AdminLayout() {
  const auth = useAuth();
  const nombre = auth.estado === 'con_sesion' ? auth.perfil.nombre : '';

  return (
    <ProveedorAvisosLecturas>
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 p-4">
          <div className="min-w-0">
            <img src="/logo/coopsar.svg" alt="COOPSAR" className="h-8 w-auto" />
            <p className="mt-1 text-xs text-slate-500">Lecturas · Administración</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-marca-50 text-marca-800' : 'text-slate-700 hover:bg-slate-100'
                }`
              }
            >
              {s.texto}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-slate-200 p-4 md:absolute md:inset-x-0 md:bottom-0 md:block">
          <p className="truncate text-sm font-medium">{nombre}</p>
          <button onClick={() => void auth.cerrarSesion()} className="mt-1 text-sm text-marca-700 hover:underline">
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex-1">
        <div className="flex items-center justify-end gap-3 px-4 pt-3 md:hidden">
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
