import { Navigate, Outlet, useLocation } from 'react-router';
import type { Rol } from '@/types/database';
import { rutaInicio, useAuth } from './contexto';
import { PantallaCarga, PantallaError, PantallaInactivo } from '@/components/Pantallas';

/** Protege un grupo de rutas: exige sesión y el rol indicado. */
export function RequiereRol({ rol }: { rol: Rol }) {
  const auth = useAuth();
  const ubicacion = useLocation();

  switch (auth.estado) {
    case 'cargando':
      return <PantallaCarga />;
    case 'sin_sesion':
      return <Navigate to="/login" replace state={{ desde: ubicacion.pathname }} />;
    case 'inactivo':
      return <PantallaInactivo />;
    case 'error':
      return <PantallaError mensaje={auth.mensaje} />;
    case 'con_sesion':
      if (auth.perfil.rol !== rol) return <Navigate to={rutaInicio(auth.perfil.rol)} replace />;
      return <Outlet />;
  }
}

/** "/" → inicio del rol, o login. */
export function RedirigirInicio() {
  const auth = useAuth();
  if (auth.estado === 'cargando') return <PantallaCarga />;
  if (auth.estado === 'con_sesion') return <Navigate to={rutaInicio(auth.perfil.rol)} replace />;
  if (auth.estado === 'inactivo') return <PantallaInactivo />;
  if (auth.estado === 'error') return <PantallaError mensaje={auth.mensaje} />;
  return <Navigate to="/login" replace />;
}
