import { createContext, useContext } from 'react';
import type { Perfil } from '@/types/database';

export type PerfilSesion = Pick<Perfil, 'id' | 'nombre' | 'email' | 'usuario' | 'rol' | 'activo'>;

export type EstadoAuth =
  | { estado: 'cargando' }
  | { estado: 'sin_sesion' }
  /** sinVerificar = sin señal: se usa el perfil guardado en el celular. */
  | { estado: 'con_sesion'; perfil: PerfilSesion; sinVerificar: boolean }
  | { estado: 'inactivo'; perfil: PerfilSesion }
  | { estado: 'error'; mensaje: string };

export type ValorAuth = EstadoAuth & {
  iniciarSesion: (usuarioOEmail: string, password: string) => Promise<void>;
  cerrarSesion: () => Promise<void>;
  reintentar: () => Promise<void>;
};

export const ContextoAuth = createContext<ValorAuth | null>(null);

export function useAuth(): ValorAuth {
  const valor = useContext(ContextoAuth);
  if (!valor) throw new Error('useAuth debe usarse dentro de <ProveedorAuth>');
  return valor;
}

/** Ruta de inicio según el rol. */
export function rutaInicio(rol: Perfil['rol']): string {
  return rol === 'admin' ? '/admin' : '/operador';
}
