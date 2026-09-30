import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EstadoLecturaLocal } from '@/lib/db';
import { fmtNumero } from '@/lib/formato';
import { normalizar } from '@/lib/texto';
import { useAuth } from '@/auth/contexto';
import { useSync } from '@/sync/contexto';
import { Aviso, Insignia } from '@/components/ui';
import { EscanearCodigo, cuentaPorCodigo } from '@/components/EscanearCodigo';

type Filtro = 'pendientes' | 'leidas' | 'todas';
const MAXIMO = 100;

const ESTADOS: Record<EstadoLecturaLocal, { texto: string; color: 'verde' | 'azul' | 'amarillo' | 'rojo' }> = {
  enviada: { texto: 'Leída', color: 'verde' },
  pendiente: { texto: 'Leída · sin enviar', color: 'azul' },
  conflicto: { texto: 'Conflicto', color: 'amarillo' },
  rechazada: { texto: 'Rechazada', color: 'rojo' },
};

export default function Buscar() {
  const auth = useAuth();
  const { descarga } = useSync();
  const ubicacion = useLocation();
  const guardada = (ubicacion.state as { guardada?: string } | null)?.guardada;
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [escaneando, setEscaneando] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState<string | null>(null);
  const navegar = useNavigate();
  const operadorId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const periodoId = descarga?.periodo?.id ?? '';

  const cuentas = useLiveQuery(() => db.cuentas.orderBy('numero_cuenta').toArray(), []);
  const leidas = useLiveQuery(
    async () => {
      const ls = await db.lecturas.where('operador_id').equals(operadorId).filter((l) => l.periodo_id === periodoId).toArray();
      return new Map(ls.map((l) => [l.cuenta_id, l.estado]));
    },
    [operadorId, periodoId],
  );

  // Índice de búsqueda: se arma una sola vez por descarga.
  const indice = useMemo(
    () => (cuentas ?? []).map((c) => ({ c, texto: normalizar(`${c.numero_cuenta} ${c.medidor} ${c.direccion} ${c.titular} ${c.ruta ?? ''}`) })),
    [cuentas],
  );

  const resultados = useMemo(() => {
    const palabras = normalizar(q).split(/\s+/).filter(Boolean);
    return indice.filter(({ c, texto }) => {
      const estado = leidas?.get(c.id);
      if (filtro === 'pendientes' && estado) return false;
      if (filtro === 'leidas' && !estado) return false;
      return palabras.every((p) => texto.includes(p));
    });
  }, [indice, q, filtro, leidas]);

  if (!descarga) {
    return (
      <Aviso tono="alerta">
        Todavía no descargaste las cuentas. Andá a <Link to="/operador" className="underline">Inicio</Link> y tocá “Descargar cuentas”
        (necesitás internet).
      </Aviso>
    );
  }

  const totalLeidas = leidas?.size ?? 0;

  function alLeerCodigo(codigo: string) {
    setEscaneando(false);
    const encontradas = cuentaPorCodigo(cuentas ?? [], codigo);
    if (encontradas.length === 1) {
      navegar(`/operador/cuenta/${encontradas[0].id}`);
      return;
    }
    const texto = codigo.replace(/^CUENTA:/i, '');
    setFiltro('todas');
    setQ(encontradas.length ? texto : '');
    setNoEncontrado(encontradas.length ? null : texto);
  }

  return (
    <div className="space-y-3">
      {guardada && <Aviso tono="exito">Lectura de la cuenta {guardada} guardada.</Aviso>}
      {!descarga.periodo && <Aviso tono="alerta">No hay un período abierto: no se pueden cargar lecturas.</Aviso>}
      <div className="flex gap-2">
        <input
          className="campo text-lg"
          type="search"
          placeholder="N° de cuenta, medidor, dirección o titular"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setNoEncontrado(null);
          }}
          autoFocus
          aria-label="Buscar cuenta"
        />
        <button type="button" className="boton-secundario shrink-0 px-3" onClick={() => setEscaneando(true)} aria-label="Escanear código">
          <span aria-hidden>📷</span> Escanear
        </button>
      </div>
      {noEncontrado && <Aviso tono="alerta">El código “{noEncontrado}” no coincide con ninguna cuenta ni medidor que tengas descargado.</Aviso>}
      <EscanearCodigo abierto={escaneando} alCerrar={() => setEscaneando(false)} alLeer={alLeerCodigo} />
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200 p-1">
        {(
          [
            ['pendientes', `Pendientes (${(cuentas?.length ?? 0) - totalLeidas})`],
            ['leidas', `Leídas (${totalLeidas})`],
            ['todas', 'Todas'],
          ] as [Filtro, string][]
        ).map(([f, texto]) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`min-h-11 rounded-lg text-sm font-medium ${filtro === f ? 'bg-white shadow-sm' : 'text-slate-600'}`}
          >
            {texto}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {resultados.slice(0, MAXIMO).map(({ c }) => {
          const estado = leidas?.get(c.id);
          return (
            <li key={c.id}>
              <Link to={`/operador/cuenta/${c.id}`} className="block rounded-2xl bg-white p-4 shadow-sm active:bg-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg font-bold">{c.numero_cuenta}</p>
                  {estado && <Insignia color={ESTADOS[estado].color}>{ESTADOS[estado].texto}</Insignia>}
                </div>
                <p className="font-medium">{c.titular}</p>
                <p className="text-sm text-slate-600">{c.direccion}</p>
                <p className="text-sm text-slate-500">
                  Medidor {c.medidor} · Última {fmtNumero(c.ultima_lectura)}
                  {c.ruta ? ` · ${c.ruta}` : ''}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      {resultados.length === 0 && <p className="py-6 text-center text-slate-500">No hay cuentas que coincidan.</p>}
      {resultados.length > MAXIMO && (
        <p className="text-center text-sm text-slate-500">Se muestran {MAXIMO} de {resultados.length}. Escribí más para acotar.</p>
      )}
    </div>
  );
}
