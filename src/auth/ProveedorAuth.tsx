import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { quitarPush } from '@/lib/push';
import { usuarioAEmail } from '@/lib/config';
import { esErrorDeRed, mensajeErrorLogin } from '@/lib/errores';
import {
  borrarPerfilGuardado,
  guardarPerfil,
  idUsuarioSesionGuardada,
  leerPerfilGuardado,
} from '@/lib/perfilLocal';
import type { Perfil } from '@/types/database';
import { ContextoAuth, type EstadoAuth, type ValorAuth } from './contexto';

const ESPERA_MAXIMA_MS = 8000;
const ESPERA_SESION_MS = 4000;

async function traerPerfil(userId: string): Promise<{ perfil: Perfil | null; falloRed: boolean }> {
  const consulta = supabase.from('perfiles').select('*').eq('id', userId).maybeSingle();
  const limite = new Promise<'tiempo'>((r) => setTimeout(() => r('tiempo'), ESPERA_MAXIMA_MS));
  const resultado = await Promise.race([consulta, limite]);
  if (resultado === 'tiempo') return { perfil: null, falloRed: true };
  if (resultado.error) return { perfil: null, falloRed: true };
  return { perfil: resultado.data, falloRed: false };
}

function estadoDesdePerfil(perfil: Perfil | NonNullable<ReturnType<typeof leerPerfilGuardado>>, sinVerificar: boolean): EstadoAuth {
  const datos = {
    id: perfil.id,
    nombre: perfil.nombre,
    email: perfil.email,
    usuario: perfil.usuario,
    rol: perfil.rol,
    activo: perfil.activo,
  };
  return datos.activo ? { estado: 'con_sesion', perfil: datos, sinVerificar } : { estado: 'inactivo', perfil: datos };
}

export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAuth>({ estado: 'cargando' });
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  /**
   * Determina quién está logueado:
   *  1. Sesión válida + perfil del servidor → sesión verificada.
   *  2. Sin señal pero con sesión y perfil guardados en el celular → se trabaja
   *     offline con el perfil guardado (sinVerificar = true).
   *  3. Nada de lo anterior → login.
   */
  const cargar = useCallback(async () => {
    const guardado = leerPerfilGuardado();
    const idGuardado = idUsuarioSesionGuardada();
    const hayPerfilGuardado = Boolean(idGuardado && guardado?.id === idGuardado);

    // Sin señal y con sesión guardada: se entra directo, sin esperar a Supabase.
    if (hayPerfilGuardado && !navigator.onLine) {
      setEstado(estadoDesdePerfil(guardado!, true));
      return;
    }

    // Con señal mala, renovar el token puede tardar (supabase-js reintenta).
    // Si tarda demasiado y hay sesión guardada, se entra offline y se verifica
    // cuando Supabase responda.
    const promesaSesion = supabase.auth.getSession();
    const primero = await Promise.race([
      promesaSesion,
      new Promise<'tiempo'>((r) => setTimeout(() => r('tiempo'), ESPERA_SESION_MS)),
    ]);
    if (primero === 'tiempo' && hayPerfilGuardado) {
      setEstado(estadoDesdePerfil(guardado!, true));
      void promesaSesion.then(({ data }) => {
        const actual = estadoRef.current;
        if (data.session && actual.estado === 'con_sesion' && actual.sinVerificar) void cargarRef.current();
      });
      return;
    }
    const { data, error } = primero === 'tiempo' ? await promesaSesion : primero;
    const userId = data.session?.user.id;

    if (!userId) {
      if (hayPerfilGuardado && esErrorDeRed(error)) {
        setEstado(estadoDesdePerfil(guardado!, true));
      } else {
        setEstado({ estado: 'sin_sesion' });
      }
      return;
    }

    const { perfil, falloRed } = await traerPerfil(userId);
    if (perfil) {
      guardarPerfil(perfil);
      setEstado(estadoDesdePerfil(perfil, false));
    } else if (falloRed && guardado?.id === userId) {
      setEstado(estadoDesdePerfil(guardado, true));
    } else if (falloRed) {
      setEstado({ estado: 'error', mensaje: 'No se pudo cargar tu perfil. Revisá la conexión y probá de nuevo.' });
    } else {
      setEstado({ estado: 'error', mensaje: 'Tu usuario no tiene un perfil asignado. Consultá con el administrador.' });
    }
  }, []);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  useEffect(() => {
    void cargar();

    const { data: suscripcion } = supabase.auth.onAuthStateChange((evento) => {
      // No se llama a Supabase dentro del callback (recomendación de supabase-js).
      if (evento === 'SIGNED_OUT') {
        borrarPerfilGuardado();
        setEstado({ estado: 'sin_sesion' });
      } else if (evento === 'TOKEN_REFRESHED') {
        const actual = estadoRef.current;
        if (actual.estado === 'con_sesion' && actual.sinVerificar) setTimeout(() => void cargar(), 0);
      }
    });

    // Al volver la señal, si estábamos usando el perfil guardado, se verifica.
    const alVolverConexion = () => {
      const actual = estadoRef.current;
      if ((actual.estado === 'con_sesion' && actual.sinVerificar) || actual.estado === 'error') void cargar();
    };
    window.addEventListener('online', alVolverConexion);

    return () => {
      suscripcion.subscription.unsubscribe();
      window.removeEventListener('online', alVolverConexion);
    };
  }, [cargar]);

  const iniciarSesion = useCallback(
    async (usuarioOEmail: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: usuarioAEmail(usuarioOEmail),
        password,
      });
      if (error) throw new Error(mensajeErrorLogin(error));
      await cargar();
    },
    [cargar],
  );

  const cerrarSesion = useCallback(async () => {
    // Que este celular deje de recibir avisos de este usuario (si hay señal).
    await Promise.race([quitarPush().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    // scope 'local': funciona también sin señal.
    await supabase.auth.signOut({ scope: 'local' });
    borrarPerfilGuardado();
    setEstado({ estado: 'sin_sesion' });
  }, []);

  const valor = useMemo<ValorAuth>(
    () => ({ ...estado, iniciarSesion, cerrarSesion, reintentar: cargar }),
    [estado, iniciarSesion, cerrarSesion, cargar],
  );

  return <ContextoAuth.Provider value={valor}>{children}</ContextoAuth.Provider>;
}
