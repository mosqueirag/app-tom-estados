import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/contexto';
import { IndicadorConexion } from '@/components/IndicadorConexion';
import { CampanaAvisos, ProveedorAvisosLecturas } from '@/components/AvisosLecturas';
import { CalendarRange, Settings, ClipboardList, History, LayoutDashboard, LogOut, MapPinned, MessagesSquare, Route, Users, UserCog, type LucideIcon } from 'lucide-react';
import { sinLeerAdmin, useMensajesEnVivo } from '@/lib/chat';
import { useConsulta } from '@/hooks/useConsulta';

const SECCIONES: { a: string; texto: string; Icono: LucideIcon; fin?: boolean }[] = [
  { a: '/admin', texto: 'Panel', Icono: LayoutDashboard, fin: true },
  { a: '/admin/cuentas', texto: 'Cuentas', Icono: Users },
  { a: '/admin/rutas', texto: 'Rutas', Icono: Route },
  { a: '/admin/lecturas', texto: 'Lecturas', Icono: ClipboardList },
  { a: '/admin/mapa', texto: 'Mapa', Icono: MapPinned },
  { a: '/admin/operadores', texto: 'Operadores', Icono: UserCog },
  { a: '/admin/mensajes', texto: 'Mensajes', Icono: MessagesSquare },
  { a: '/admin/periodos', texto: 'Períodos', Icono: CalendarRange },
  { a: '/admin/historial', texto: 'Historial', Icono: History },
  { a: '/admin/configuracion', texto: 'Configuración', Icono: Settings },
];

export default function AdminLayout() {
  const auth = useAuth();
  const nombre = auth.estado === 'con_sesion' ? auth.perfil.nombre : '';
  const sinLeer = useConsulta(sinLeerAdmin, []);
  useMensajesEnVivo((m) => {
    void sinLeer.recargar();
    // Mensaje nuevo de un operador con la pestaña en segundo plano: aviso del navegador
    if (m && m.autor_id && m.autor_id === m.para_id && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Mensaje de un operador', { body: m.texto.slice(0, 180), icon: '/icons/medidor-192.png', tag: `chat-${m.id}` });
      } catch {
        /* algunos navegadores solo permiten notificar desde el service worker */
      }
    }
  });
  const noLeidos = sinLeer.datos ?? 0;

  return (
    <ProveedorAvisosLecturas>
    <div className="min-h-screen md:flex">
      <aside className="fondo-marca-suave border-b border-marca-100 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0 md:pb-36">
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          <div className="min-w-0">
            <img src="/logo/coopsar.svg" alt="COOPSAR" className="logo-coopsar h-8 w-auto max-w-full md:h-9" />
            <p className="texto-marca mt-1 truncate text-xs font-semibold tracking-wide uppercase">Lecturas</p>
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
              {s.a === '/admin/mensajes' && noLeidos > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-red-600 px-1.5 text-center text-xs font-bold leading-5 text-white" aria-label={`${noLeidos} sin leer`}>
                  {noLeidos > 99 ? '99+' : noLeidos}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-marca-100 p-4 md:absolute md:inset-x-0 md:bottom-0 md:block">
          <p className="truncate text-sm font-medium">{nombre}</p>
          <button onClick={() => void auth.cerrarSesion()} className="mt-1 inline-flex items-center gap-1 text-sm text-marca-700 hover:underline">
            <LogOut className="size-4" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-end gap-3 px-4 pt-3 md:hidden">
          <span className="truncate text-sm text-slate-600">{nombre}</span>
          <button onClick={() => void auth.cerrarSesion()} className="text-sm font-medium text-marca-700">
            Salir
          </button>
        </div>
        <main className="mx-auto max-w-[1600px] p-4 md:p-6 xl:p-8">
          <Outlet />
        </main>
      </div>
    </div>
    </ProveedorAvisosLecturas>
  );
}
