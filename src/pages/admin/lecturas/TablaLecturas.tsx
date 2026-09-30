import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { VerFoto } from '@/components/VerFoto';
import { EscucharNota } from '@/components/EscucharNota';
import { HistorialConsumo } from '@/components/HistorialConsumo';
import { linkMapa } from '@/lib/ubicacion';
import { useAlCambiarLecturas } from '@/components/AvisosLecturas';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Insignia, Paginador, Tarjeta } from '@/components/ui';
import type { VLectura } from '@/types/database';
import { CorregirLectura } from './CorregirLectura';

export type FiltrosLecturas = {
  periodoId: string;
  operadorId: string;
  estado: 'todas' | 'con_lectura' | 'sin_lectura' | 'corregidas';
  alerta: 'todas' | 'cualquiera' | 'menor_anterior' | 'consumo_anomalo' | 'sin_lectura';
  q: string;
};

// Aplica los filtros a una consulta sobre v_lecturas (sirve para la tabla y para exportar).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aplicarFiltros<Q extends { eq: any; not: any; or: any }>(consulta: Q, f: FiltrosLecturas): Q {
  let c = consulta.eq('periodo_id', f.periodoId);
  if (f.operadorId) c = c.eq('operador_id', f.operadorId);
  if (f.estado === 'con_lectura') c = c.eq('sin_lectura', false);
  if (f.estado === 'sin_lectura') c = c.eq('sin_lectura', true);
  if (f.estado === 'corregidas') c = c.not('corregida_at', 'is', null);
  if (f.alerta === 'menor_anterior') c = c.eq('alerta_menor_anterior', true);
  if (f.alerta === 'consumo_anomalo') c = c.eq('alerta_consumo_anomalo', true);
  if (f.alerta === 'sin_lectura') c = c.eq('alerta_sin_lectura', true);
  if (f.alerta === 'cualquiera') c = c.or('alerta_menor_anterior.eq.true,alerta_consumo_anomalo.eq.true,alerta_sin_lectura.eq.true');
  if (f.q) c = c.or(`numero_cuenta.ilike.%${f.q}%,titular.ilike.%${f.q}%,direccion.ilike.%${f.q}%,medidor.ilike.%${f.q}%`);
  return c;
}

const POR_PAGINA = 50;

export function TablaLecturas({ filtros, periodoActivo }: { filtros: FiltrosLecturas; periodoActivo: boolean }) {
  const [pagina, setPagina] = useState(0);
  const [corrigiendo, setCorrigiendo] = useState<VLectura | null>(null);
  const [foto, setFoto] = useState<VLectura | null>(null);
  const [nota, setNota] = useState<VLectura | null>(null);
  const [historial, setHistorial] = useState<VLectura | null>(null);
  const clave = JSON.stringify(filtros);
  const [claveAnterior, setClaveAnterior] = useState(clave);
  if (clave !== claveAnterior) {
    setClaveAnterior(clave);
    setPagina(0);
  }

  const lista = useConsulta(async () => {
    if (!filtros.periodoId) return { filas: [] as VLectura[], total: 0 };
    const { data, error, count } = await aplicarFiltros(supabase.from('v_lecturas').select('*', { count: 'exact' }), filtros)
      .order('fecha_lectura', { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (error) throw error;
    return { filas: data, total: count ?? 0 };
  }, [clave, pagina]);
  useAlCambiarLecturas(() => void lista.recargar());

  return (
    <Tarjeta className="p-0">
      {lista.error && <Aviso tono="error" className="m-4">{lista.error}</Aviso>}
      {lista.cargando && !lista.datos ? (
        <Cargando />
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>N° cuenta</th>
                <th>Titular</th>
                <th className="text-right">Anterior</th>
                <th className="text-right">Actual</th>
                <th className="text-right">Consumo</th>
                <th>Operador</th>
                <th>Fecha</th>
                <th>Alertas</th>
                <th>Foto y lugar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.datos?.filas.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">{l.numero_cuenta}</td>
                  <td>
                    {l.titular}
                    {l.observacion && <div className="text-xs text-slate-500">“{l.observacion}”</div>}
                  </td>
                  <td className="text-right tabular-nums">{fmtNumero(l.lectura_anterior)}</td>
                  <td className="text-right tabular-nums font-medium">{l.sin_lectura ? '—' : fmtNumero(l.lectura_actual)}</td>
                  <td className="text-right tabular-nums">{fmtNumero(l.consumo)}</td>
                  <td>{l.operador_nombre}</td>
                  <td className="whitespace-nowrap">{fmtFechaHora(l.fecha_lectura)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {l.alerta_menor_anterior && <Insignia color="rojo">Menor a la anterior</Insignia>}
                      {l.alerta_consumo_anomalo && <Insignia color="amarillo">Consumo anómalo</Insignia>}
                      {l.alerta_sin_lectura && <Insignia>Sin lectura</Insignia>}
                      {l.corregida_at && (
                        <Insignia color="violeta">
                          Corregida por {l.corregida_por_nombre ?? 'admin'}
                        </Insignia>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    {l.foto_path && (
                      <button className="boton-chico mr-1" onClick={() => setFoto(l)}>
                        Foto
                      </button>
                    )}
                    {l.latitud !== null && l.longitud !== null && (
                      <a
                        className="boton-chico"
                        href={linkMapa(l)}
                        target="_blank"
                        rel="noreferrer"
                        title={l.precision_gps ? `Precisión ±${Math.round(l.precision_gps)} m` : undefined}
                      >
                        Mapa
                      </a>
                    )}
                    {l.audio_path && (
                      <button className="boton-chico mr-1" onClick={() => setNota(l)} aria-label={`Escuchar nota de voz de ${l.numero_cuenta}`}>
                        🎙️ Nota
                      </button>
                    )}
                    {!l.foto_path && !l.audio_path && l.latitud === null && <span className="text-xs text-slate-400">—</span>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button className="boton-chico mr-1" onClick={() => setHistorial(l)}>
                      Historial
                    </button>
                    <button className="boton-chico" onClick={() => setCorrigiendo(l)}>
                      {periodoActivo ? 'Corregir' : 'Ver'}
                    </button>
                  </td>
                </tr>
              ))}
              {lista.datos?.filas.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    No hay lecturas con estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-4 pb-4">
        <Paginador pagina={pagina} porPagina={POR_PAGINA} total={lista.datos?.total ?? 0} alCambiar={setPagina} />
      </div>
      <HistorialConsumo
        cuenta={historial ? { id: historial.cuenta_id, numero_cuenta: historial.numero_cuenta, titular: historial.titular } : null}
        alCerrar={() => setHistorial(null)}
      />
      <EscucharNota
        titulo={nota ? `Nota de voz · cuenta ${nota.numero_cuenta}` : ''}
        path={nota?.audio_path ?? null}
        alCerrar={() => setNota(null)}
      />
      <VerFoto titulo={foto ? `Cuenta ${foto.numero_cuenta} · ${fmtFechaHora(foto.fecha_lectura)}` : ''} path={foto?.foto_path ?? null} alCerrar={() => setFoto(null)} />
      <CorregirLectura
        lectura={corrigiendo}
        editable={periodoActivo}
        alCerrar={() => setCorrigiendo(null)}
        alGuardar={() => {
          setCorrigiendo(null);
          void lista.recargar();
        }}
      />
    </Tarjeta>
  );
}
