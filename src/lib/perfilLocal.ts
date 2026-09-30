import type { Perfil } from '@/types/database';

// Copia del perfil en el celular. Permite abrir la app sin señal y saber
// quién es el usuario y qué rol tiene aunque no se pueda consultar Supabase.
const CLAVE_PERFIL = 'lecturas-perfil';
// Misma clave que usa el cliente de Supabase para guardar la sesión.
export const CLAVE_SESION = 'lecturas-auth';

export type PerfilGuardado = Pick<Perfil, 'id' | 'nombre' | 'email' | 'usuario' | 'rol' | 'activo'> & {
  guardado_at: string;
};

export function guardarPerfil(perfil: Perfil): void {
  const datos: PerfilGuardado = {
    id: perfil.id,
    nombre: perfil.nombre,
    email: perfil.email,
    usuario: perfil.usuario,
    rol: perfil.rol,
    activo: perfil.activo,
    guardado_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CLAVE_PERFIL, JSON.stringify(datos));
  } catch {
    // almacenamiento lleno o bloqueado: la app sigue funcionando online
  }
}

export function leerPerfilGuardado(): PerfilGuardado | null {
  try {
    const crudo = localStorage.getItem(CLAVE_PERFIL);
    return crudo ? (JSON.parse(crudo) as PerfilGuardado) : null;
  } catch {
    return null;
  }
}

export function borrarPerfilGuardado(): void {
  try {
    localStorage.removeItem(CLAVE_PERFIL);
  } catch {
    /* nada */
  }
}

/** Id del usuario de la sesión guardada por Supabase (aunque el token esté vencido). */
export function idUsuarioSesionGuardada(): string | null {
  try {
    const crudo = localStorage.getItem(CLAVE_SESION);
    if (!crudo) return null;
    const sesion = JSON.parse(crudo) as { user?: { id?: string }; refresh_token?: string };
    return sesion?.refresh_token && sesion.user?.id ? sesion.user.id : null;
  } catch {
    return null;
  }
}
