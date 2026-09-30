import { useEffect, useState } from 'react';
import { activarPush, estadoPush, type EstadoPush } from '@/lib/push';
import { mensajeError } from '@/lib/consultas';

/** Tarjeta para que el operador active los avisos push en su celular. */
export function ActivarAvisos() {
  const [estado, setEstado] = useState<EstadoPush>(() => estadoPush());
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const alVolver = () => setEstado(estadoPush());
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, []);

  async function activar() {
    setTrabajando(true);
    setError(null);
    try {
      setEstado(await activarPush());
    } catch (e) {
      setError(`No se pudieron activar los avisos: ${mensajeError(e)}`);
    } finally {
      setTrabajando(false);
    }
  }

  if (estado === 'activo' || estado === 'sin_configurar' || estado === 'no_soportado') return null;

  return (
    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <p className="font-semibold">Avisos en el celular</p>
      {estado === 'preguntar' && (
        <>
          <p className="mt-1 text-sm text-slate-700">Activalos para enterarte cuando el administrador te asigne cuentas nuevas.</p>
          <button className="boton-primario mt-3 w-full" onClick={() => void activar()} disabled={trabajando}>
            {trabajando ? 'Activando…' : 'Activar avisos'}
          </button>
        </>
      )}
      {estado === 'instalar_iphone' && (
        <p className="mt-1 text-sm text-slate-700">
          En iPhone los avisos llegan solo si la app está instalada: tocá Compartir → <strong>Agregar a inicio</strong>, abrila
          desde ese ícono y activá los avisos.
        </p>
      )}
      {estado === 'bloqueado' && (
        <p className="mt-1 text-sm text-slate-700">
          Los avisos están bloqueados para esta app. Habilitalos en los ajustes del celular (Notificaciones) y volvé a abrirla.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
