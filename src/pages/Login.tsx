import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { rutaInicio, useAuth } from '@/auth/contexto';
import { IndicadorConexion } from '@/components/IndicadorConexion';
import { PantallaCarga } from '@/components/Pantallas';
import { useConexion } from '@/hooks/useConexion';

export default function Login() {
  const auth = useAuth();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const enLinea = useConexion();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (auth.estado === 'cargando') return <PantallaCarga />;
  if (auth.estado === 'con_sesion' && !enviando) return <Navigate to={rutaInicio(auth.perfil.rol)} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!usuario.trim() || !password) {
      setError('Completá usuario y contraseña.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await auth.iniciarSesion(usuario, password);
      const desde = (ubicacion.state as { desde?: string } | null)?.desde;
      navegar(desde && desde !== '/login' ? desde : '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <header className="fondo-marca-suave space-y-2 rounded-3xl border border-marca-100 p-6 text-center shadow-sm">
        <img src="/logo/coopsar.svg" alt="COOPSAR" className="logo-coopsar mx-auto h-12 w-auto" />
        <h1 className="texto-marca text-2xl font-bold">Lecturas de medidores</h1>
        <IndicadorConexion />
      </header>

      <form onSubmit={enviar} className="space-y-4" noValidate>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Email o usuario</span>
          <input
            className="campo"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            placeholder="ej. jperez"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Contraseña</span>
          <div className="relative">
            <input
              className="campo pr-20"
              type={verPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setVerPassword((v) => !v)}
              className="absolute inset-y-0 right-0 px-4 text-sm font-medium text-marca-700"
            >
              {verPassword ? 'Ocultar' : 'Ver'}
            </button>
          </div>
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        <button type="submit" className="boton-primario w-full" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500">
        {enLinea
          ? 'La primera vez necesitás internet. Después la sesión queda guardada y podés trabajar sin señal.'
          : 'Sin conexión: para iniciar sesión por primera vez necesitás internet.'}
      </p>
      <Link to="/instalar" className="text-center text-sm font-medium text-marca-700 underline">
        ¿Cómo instalo la app en el celular?
      </Link>
    </main>
  );
}
