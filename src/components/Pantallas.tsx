import type { ReactNode } from 'react';
import { useAuth } from '@/auth/contexto';

function Centrado({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      {children}
    </main>
  );
}

export function PantallaCarga() {
  return (
    <Centrado>
      <div className="size-10 animate-spin rounded-full border-4 border-marca-100 border-t-marca-600" aria-hidden />
      <p className="text-slate-600">Cargando…</p>
    </Centrado>
  );
}

export function PantallaError({ mensaje }: { mensaje: string }) {
  const { reintentar, cerrarSesion } = useAuth();
  return (
    <Centrado>
      <h1 className="text-xl font-semibold">No se pudo continuar</h1>
      <p className="text-slate-600">{mensaje}</p>
      <button onClick={() => void reintentar()} className="boton-primario w-full">
        Reintentar
      </button>
      <button onClick={() => void cerrarSesion()} className="boton-secundario w-full">
        Cerrar sesión
      </button>
    </Centrado>
  );
}

export function PantallaInactivo() {
  const { cerrarSesion } = useAuth();
  return (
    <Centrado>
      <h1 className="text-xl font-semibold">Usuario desactivado</h1>
      <p className="text-slate-600">
        Tu usuario fue desactivado y no puede cargar lecturas. Consultá con el administrador.
      </p>
      <button onClick={() => void cerrarSesion()} className="boton-primario w-full">
        Cerrar sesión
      </button>
    </Centrado>
  );
}

export function PantallaConfigFaltante() {
  return (
    <Centrado>
      <h1 className="text-xl font-semibold text-marca-700">Lecturas de medidores</h1>
      <p className="rounded-lg bg-amber-100 p-4 text-sm text-amber-900">
        Falta configurar la conexión con Supabase. Completá <code>VITE_SUPABASE_URL</code> y{' '}
        <code>VITE_SUPABASE_ANON_KEY</code> en el archivo <code>.env</code> (o en las variables de
        entorno de Netlify) y volvé a publicar la app.
      </p>
    </Centrado>
  );
}

export function PantallaNoEncontrada() {
  return (
    <Centrado>
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <a href="/" className="boton-primario w-full">
        Ir al inicio
      </a>
    </Centrado>
  );
}
