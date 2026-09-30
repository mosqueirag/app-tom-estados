import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CuentaLocal } from '@/lib/db';
import { linkMapa } from '@/lib/ubicacion';
import { useAuth } from '@/auth/contexto';
import { useSync } from '@/sync/contexto';
import { Aviso, Insignia } from '@/components/ui';

const CLAVE_RUTA = 'recorrido-ruta';
const SIN_RUTA = '';

function leerRuta(): string | null {
  try {
    return localStorage.getItem(CLAVE_RUTA);
  } catch {
    return null;
  }
}

/** Orden del recorrido: primero el orden que puso el admin, después por número. */
function comparar(a: CuentaLocal, b: CuentaLocal) {
  const oa = a.orden ?? Number.MAX_SAFE_INTEGER;
  const ob = b.orden ?? Number.MAX_SAFE_INTEGER;
  return oa - ob || a.numero_cuenta.localeCompare(b.numero_cuenta, 'es', { numeric: true });
}

export default function Recorrido() {
  const auth = useAuth();
  const { descarga } = useSync();
  const operadorId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const periodoId = descarga?.periodo?.id ?? '';
  const [elegida, setElegida] = useState<string | null>(leerRuta);
  const [verLeidas, setVerLeidas] = useState(false);

  const cuentas = useLiveQuery(() => db.cuentas.toArray(), []);
  const leidas = useLiveQuery(
    async () => new Set((await db.lecturas.where('operador_id').equals(operadorId).filter((l) => l.periodo_id === periodoId).toArray()).map((l) => l.cuenta_id)),
    [operadorId, periodoId],
  );

  const rutas = useMemo(() => {
    const porRuta = new Map<string, number>();
    for (const c of cuentas ?? []) porRuta.set(c.ruta ?? SIN_RUTA, (porRuta.get(c.ruta ?? SIN_RUTA) ?? 0) + 1);
    return [...porRuta.entries()].sort(([a], [b]) => (a === SIN_RUTA ? 1 : b === SIN_RUTA ? -1 : a.localeCompare(b, 'es', { numeric: true })));
  }, [cuentas]);

  const ruta = elegida !== null && rutas.some(([r]) => r === elegida) ? elegida : (rutas[0]?.[0] ?? SIN_RUTA);
  const delRecorrido = useMemo(() => (cuentas ?? []).filter((c) => (c.ruta ?? SIN_RUTA) === ruta).sort(comparar), [cuentas, ruta]);
  const pendientes = delRecorrido.filter((c) => !leidas?.has(c.id));
  const visibles = verLeidas ? delRecorrido : pendientes;
  const siguiente = pendientes[0];

  function elegir(r: string) {
    setElegida(r);
    try {
      localStorage.setItem(CLAVE_RUTA, r);
    } catch {
      /* no importa si no se guarda */
    }
  }

  if (!descarga) {
    return (
      <Aviso tono="alerta">
        Todavía no descargaste las cuentas. Andá a <Link to="/operador" className="underline">Inicio</Link> y tocá “Descargar cuentas”.
      </Aviso>
    );
  }

  if (cuentas === undefined || leidas === undefined) return null;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Recorrido</h1>
      {rutas.length > 1 && (
        <select className="campo text-lg" value={ruta} onChange={(e) => elegir(e.target.value)} aria-label="Ruta">
          {rutas.map(([r, n]) => (
            <option key={r} value={r}>
              {r || 'Sin ruta'} ({n})
            </option>
          ))}
        </select>
      )}
      <p className="text-sm text-slate-600">
        {pendientes.length === 0
          ? `Terminaste ${ruta || 'las cuentas sin ruta'}: todas leídas.`
          : `Faltan ${pendientes.length} de ${delRecorrido.length} cuentas${ruta ? ` en ${ruta}` : ''}.`}
      </p>

      {siguiente && (
        <section className="rounded-2xl border-2 border-marca-300 bg-marca-50 p-4">
          <p className="text-sm font-medium text-marca-800">Siguiente</p>
          <p className="text-xl font-bold">
            {siguiente.orden ? `${siguiente.orden}. ` : ''}
            {siguiente.direccion}
          </p>
          <p>
            Cuenta {siguiente.numero_cuenta} · {siguiente.titular}
          </p>
          <p className="text-sm text-slate-600">Medidor {siguiente.medidor}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a className="boton-secundario" href={linkMapa({ ...siguiente, localidad: descarga.localidad })} target="_blank" rel="noreferrer">
              Cómo llegar
            </a>
            <Link className="boton-primario" to={`/operador/cuenta/${siguiente.id}`}>
              Cargar lectura
            </Link>
          </div>
        </section>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={verLeidas} onChange={(e) => setVerLeidas(e.target.checked)} />
        Mostrar también las leídas
      </label>

      <ol className="space-y-2">
        {visibles.map((c) => {
          const leida = leidas?.has(c.id);
          return (
            <li key={c.id} className="flex items-stretch gap-2">
              <Link to={`/operador/cuenta/${c.id}`} className={`flex-1 rounded-2xl bg-white p-3 shadow-sm active:bg-slate-50 ${leida ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">
                    {c.orden ? `${c.orden}. ` : ''}
                    {c.direccion}
                  </p>
                  {leida && <Insignia color="verde">Leída</Insignia>}
                </div>
                <p className="text-sm text-slate-600">
                  {c.numero_cuenta} · {c.titular}
                </p>
              </Link>
              <a
                className="grid w-16 place-items-center rounded-2xl bg-white text-center text-xs font-medium text-marca-700 shadow-sm"
                href={linkMapa({ ...c, localidad: descarga.localidad })}
                target="_blank"
                rel="noreferrer"
                aria-label={`Cómo llegar a ${c.direccion}`}
              >
                Mapa
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
