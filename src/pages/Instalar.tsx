import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { esIOS } from '@/sync/contexto';

type EventoInstalacion = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

function yaInstalada(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Ayuda para instalar la app en Android y iPhone. Se usa en /instalar y en /operador/ayuda. */
export default function Instalar({ conVolver = false }: { conVolver?: boolean }) {
  const [evento, setEvento] = useState<EventoInstalacion | null>(null);
  const [instalada, setInstalada] = useState(yaInstalada());
  const ios = esIOS();

  useEffect(() => {
    const alOfrecer = (e: Event) => {
      e.preventDefault();
      setEvento(e as EventoInstalacion);
    };
    const alInstalar = () => setInstalada(true);
    window.addEventListener('beforeinstallprompt', alOfrecer);
    window.addEventListener('appinstalled', alInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', alOfrecer);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);

  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    if (outcome === 'accepted') setInstalada(true);
    setEvento(null);
  }

  return (
    <div className={`space-y-4 ${conVolver ? 'mx-auto max-w-lg p-4' : ''}`}>
      <h1 className="text-2xl font-bold">Instalar la app</h1>
      {instalada ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">La app ya está instalada en este dispositivo. 👍</p>
      ) : (
        evento && (
          <button className="boton-primario w-full" onClick={() => void instalar()}>
            Instalar ahora
          </button>
        )
      )}

      <section className={`rounded-2xl bg-white p-4 shadow-sm ${ios ? 'order-2' : ''}`}>
        <h2 className="text-lg font-semibold">Android (Chrome)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Abrí la dirección de la app en <strong>Chrome</strong>.</li>
          <li>
            Tocá el menú <strong>⋮</strong> (arriba a la derecha).
          </li>
          <li>
            Elegí <strong>“Instalar app”</strong> (o “Agregar a la pantalla principal”) y confirmá.
          </li>
          <li>Abrí la app desde el ícono “Lecturas” en tu pantalla.</li>
        </ol>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">iPhone (Safari)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Abrí la dirección de la app en <strong>Safari</strong> (no funciona desde otros navegadores).
          </li>
          <li>
            Tocá el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba).
          </li>
          <li>
            Bajá y elegí <strong>“Agregar a inicio”</strong>, y después <strong>“Agregar”</strong>.
          </li>
          <li>Abrí la app desde el ícono “Lecturas” en tu pantalla.</li>
        </ol>
      </section>

      <section className="rounded-2xl bg-amber-50 p-4 text-amber-950">
        <h2 className="text-lg font-semibold">Para trabajar sin señal</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>La primera vez iniciá sesión con internet. Después la sesión queda guardada.</li>
          <li>Antes de salir, tocá “Descargar cuentas” en Inicio.</li>
          <li>Sin señal podés buscar cuentas y cargar lecturas: quedan guardadas en el celular.</li>
          <li>
            Las lecturas se envían <strong>solo con la app abierta</strong> y con señal: al abrirla, cuando vuelve la señal, cada 2 minutos o con
            “Sincronizar ahora”. {ios && 'En iPhone no hay envío en segundo plano.'}
          </li>
          <li>No cierres sesión ni borres los datos del navegador si tenés lecturas pendientes.</li>
        </ul>
      </section>

      {conVolver && (
        <Link to="/" className="boton-secundario w-full">
          Volver
        </Link>
      )}
    </div>
  );
}
