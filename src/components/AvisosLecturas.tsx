import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { Insignia } from '@/components/ui';
import type { VLectura } from '@/types/database';
import { DetalleAviso } from '@/components/DetalleAviso';
import { Bell, ChevronRight } from 'lucide-react';

// Avisos del admin: cada lectura que sincroniza un operador llega al instante
// (Supabase Realtime) y queda en la campana hasta que se marca como leída.

export type AvisoLectura = {
  id: string;
  tipo: 'lectura' | 'conflicto';
  numero_cuenta: string;
  titular: string;
  operador_nombre: string | null;
  lectura_actual: number | null;
  consumo: number | null;
  sin_lectura: boolean;
  observacion: string | null;
  alerta_menor_anterior: boolean;
  alerta_consumo_anomalo: boolean;
  fecha_lectura: string; // cuándo la tomó el operador
  recibida_at: string; // cuándo llegó al servidor
  leida: boolean;
};

type Contexto = {
  avisos: AvisoLectura[];
  noLeidos: number;
  marcarLeidos: () => void;
  borrar: () => void;
  escuchar: (fn: () => void) => () => void;
};

const CLAVE = 'avisos-lecturas';
const MAXIMO = 50;
const ESPERA_MS = 800; // junta las lecturas que llegan en la misma sincronización

const ContextoAvisos = createContext<Contexto | null>(null);

function leerGuardados(): AvisoLectura[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function ProveedorAvisosLecturas({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<AvisoLectura[]>(leerGuardados);
  const [cartel, setCartel] = useState<string | null>(null);
  const oyentes = useRef(new Set<() => void>());
  const pendientes = useRef({ lecturas: new Set<string>(), conflictos: new Set<string>() });
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(avisos));
    } catch {
      /* sin almacenamiento: los avisos duran mientras la pestaña esté abierta */
    }
  }, [avisos]);

  const avisarOyentes = useCallback(() => oyentes.current.forEach((fn) => fn()), []);

  const procesar = useCallback(async () => {
    const lecturas = [...pendientes.current.lecturas];
    const conflictos = [...pendientes.current.conflictos];
    pendientes.current.lecturas.clear();
    pendientes.current.conflictos.clear();
    const ahora = new Date().toISOString();
    const nuevos: AvisoLectura[] = [];

    if (lecturas.length) {
      const { data } = await supabase.from('v_lecturas').select('*').in('id', lecturas);
      for (const l of (data ?? []) as VLectura[]) {
        nuevos.push({
          id: l.id,
          tipo: 'lectura',
          numero_cuenta: l.numero_cuenta,
          titular: l.titular,
          operador_nombre: l.operador_nombre,
          lectura_actual: l.lectura_actual,
          consumo: l.consumo,
          sin_lectura: l.sin_lectura,
          observacion: l.observacion,
          alerta_menor_anterior: l.alerta_menor_anterior,
          alerta_consumo_anomalo: l.alerta_consumo_anomalo,
          fecha_lectura: l.fecha_lectura,
          recibida_at: ahora,
          leida: false,
        });
      }
    }
    if (conflictos.length) {
      const { data } = await supabase.from('v_conflictos').select('*').in('id', conflictos);
      for (const c of data ?? []) {
        nuevos.push({
          id: c.id,
          tipo: 'conflicto',
          numero_cuenta: c.numero_cuenta,
          titular: c.titular,
          operador_nombre: c.operador_nombre,
          lectura_actual: c.lectura_actual,
          consumo: null,
          sin_lectura: c.sin_lectura,
          observacion: c.observacion,
          alerta_menor_anterior: false,
          alerta_consumo_anomalo: false,
          fecha_lectura: c.fecha_lectura,
          recibida_at: ahora,
          leida: false,
        });
      }
    }
    avisarOyentes();
    if (!nuevos.length) return;

    nuevos.sort((a, b) => b.fecha_lectura.localeCompare(a.fecha_lectura));
    setAvisos((antes) => [...nuevos, ...antes.filter((a) => !nuevos.some((n) => n.id === a.id))].slice(0, MAXIMO));

    const primero = nuevos[0];
    const texto =
      nuevos.length === 1
        ? `${primero.tipo === 'conflicto' ? 'Conflicto' : 'Nueva lectura'}: cuenta ${primero.numero_cuenta}${primero.operador_nombre ? ` · ${primero.operador_nombre}` : ''}`
        : `Llegaron ${nuevos.length} lecturas nuevas${primero.operador_nombre ? ` de ${primero.operador_nombre}` : ''}`;
    setCartel(texto);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Lecturas', { body: texto, icon: '/icons/medidor-192.png', tag: 'lecturas-admin' });
      } catch {
        /* algunos navegadores solo permiten notificar desde el service worker */
      }
    }
  }, [avisarOyentes]);

  useEffect(() => {
    const encolar = (tipo: 'lecturas' | 'conflictos', id: string | undefined) => {
      if (id) pendientes.current[tipo].add(id);
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => void procesar(), ESPERA_MS);
    };
    const canal = supabase
      .channel('admin-lecturas')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lecturas' }, (p) =>
        encolar('lecturas', (p.new as { id?: string }).id),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lecturas_conflictos' }, (p) =>
        encolar('conflictos', (p.new as { id?: string }).id),
      )
      // Correcciones y conflictos resueltos: solo refrescan las pantallas.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lecturas' }, () => encolar('lecturas', undefined))
      .subscribe();
    return () => {
      clearTimeout(temporizador.current);
      void supabase.removeChannel(canal);
    };
  }, [procesar]);

  useEffect(() => {
    if (!cartel) return;
    const t = setTimeout(() => setCartel(null), 6000);
    return () => clearTimeout(t);
  }, [cartel]);

  const escuchar = useCallback((fn: () => void) => {
    oyentes.current.add(fn);
    return () => void oyentes.current.delete(fn);
  }, []);

  const valor: Contexto = {
    avisos,
    noLeidos: avisos.filter((a) => !a.leida).length,
    marcarLeidos: () => setAvisos((antes) => antes.map((a) => ({ ...a, leida: true }))),
    borrar: () => setAvisos([]),
    escuchar,
  };

  return (
    <ContextoAvisos.Provider value={valor}>
      {children}
      {cartel && (
        <div role="status" className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-sm rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl md:right-4 md:left-auto md:mx-0">
          {cartel}
        </div>
      )}
    </ContextoAvisos.Provider>
  );
}

function useAvisos(): Contexto {
  const c = useContext(ContextoAvisos);
  if (!c) throw new Error('Falta ProveedorAvisosLecturas');
  return c;
}

/** Ejecuta `fn` cada vez que llegan o cambian lecturas (para refrescar una pantalla). */
export function useAlCambiarLecturas(fn: () => void) {
  const c = useContext(ContextoAvisos);
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => c?.escuchar(() => ref.current()), [c]);
}

export function CampanaAvisos() {
  const { avisos, noLeidos, marcarLeidos, borrar } = useAvisos();
  const [abierto, setAbierto] = useState(false);
  const [detalle, setDetalle] = useState<AvisoLectura | null>(null);
  const [permiso, setPermiso] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  function alternar() {
    if (abierto) marcarLeidos();
    setAbierto(!abierto);
  }

  return (
    <div className="relative" ref={caja}>
      <button
        onClick={alternar}
        className="relative rounded-full p-2 text-marca-800 hover:bg-marca-100"
        aria-label={noLeidos ? `Avisos: ${noLeidos} sin leer` : 'Avisos'}
        aria-expanded={abierto}
      >
        <Bell className="size-6" strokeWidth={1.8} aria-hidden="true" />
        {noLeidos > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-bold leading-5 text-white">
            {noLeidos > 99 ? '99+' : noLeidos}
          </span>
        )}
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-label="Avisos de lecturas"
          className="fixed inset-x-3 top-16 z-40 max-h-[70vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl md:absolute md:inset-x-auto md:top-full md:left-0 md:mt-2 md:w-96"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="font-semibold">Lecturas recibidas</p>
            {avisos.length > 0 && (
              <button className="text-sm text-slate-500 hover:underline" onClick={borrar}>
                Vaciar
              </button>
            )}
          </div>
          <div className="max-h-[calc(70vh-7rem)] overflow-y-auto">
            {avisos.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                Todavía no llegaron lecturas. Aparecen acá apenas un operador sincroniza.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {avisos.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition hover:bg-marca-100/60 ${a.leida ? '' : 'bg-marca-50'}`}
                      onClick={() => {
                        setDetalle(a);
                        alternar();
                      }}
                      aria-label={`Ver detalle de la cuenta ${a.numero_cuenta}`}
                    >
                      <span className="block min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span>
                        <strong>{a.numero_cuenta}</strong> · {a.titular}
                      </span>
                      <time className="shrink-0 text-xs text-slate-500" dateTime={a.fecha_lectura}>
                        {fmtFechaHora(a.fecha_lectura)}
                      </time>
                    </span>
                    <span className="mt-0.5 block text-slate-600">
                      {a.operador_nombre ?? 'Operador'} ·{' '}
                      {a.sin_lectura ? `Sin lectura${a.observacion ? `: ${a.observacion}` : ''}` : `Lectura ${fmtNumero(a.lectura_actual)}`}
                      {a.consumo !== null && ` · Consumo ${fmtNumero(a.consumo)}`}
                    </span>
                    {(a.tipo === 'conflicto' || a.alerta_menor_anterior || a.alerta_consumo_anomalo || a.sin_lectura) && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {a.tipo === 'conflicto' && <Insignia color="amarillo">Conflicto</Insignia>}
                        {a.alerta_menor_anterior && <Insignia color="rojo">Menor a la anterior</Insignia>}
                        {a.alerta_consumo_anomalo && <Insignia color="amarillo">Consumo anómalo</Insignia>}
                        {a.sin_lectura && a.tipo === 'lectura' && <Insignia>Sin lectura</Insignia>}
                      </span>
                    )}
                  </span>
                      <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm">
            <Link to="/admin/lecturas" className="font-medium text-marca-700 hover:underline" onClick={() => alternar()}>
              Ver todas las lecturas
            </Link>
            {permiso === 'default' && (
              <button
                className="text-marca-700 hover:underline"
                onClick={() => void Notification.requestPermission().then(setPermiso)}
              >
                Avisarme aunque no esté mirando
              </button>
            )}
          </div>
        </div>
      )}
      <DetalleAviso aviso={detalle} alCerrar={() => setDetalle(null)} />
    </div>
  );
}
