import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtNumero } from '@/lib/formato';
import { useAlCambiarLecturas } from '@/components/AvisosLecturas';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Paginador, Tarjeta } from '@/components/ui';
import { BellRing } from 'lucide-react';
import { AvisarPendientes } from './AvisarPendientes';

const POR_PAGINA = 50;

/** Cuentas activas que todavía no tienen lectura en el período. */
export function TablaPendientes({
  periodoId,
  periodoNombre = '',
  periodoActivo = false,
  avisarAlAbrir = false,
}: {
  periodoId: string;
  periodoNombre?: string;
  periodoActivo?: boolean;
  avisarAlAbrir?: boolean;
}) {
  const [pagina, setPagina] = useState(0);
  const [avisando, setAvisando] = useState(avisarAlAbrir && periodoActivo);
  const lista = useConsulta(async () => {
    const { data, error, count } = await supabase
      .rpc('cuentas_pendientes', { p_periodo_id: periodoId }, { count: 'exact' })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (error) throw error;
    return { filas: data, total: count ?? 0 };
  }, [periodoId, pagina]);
  useAlCambiarLecturas(() => void lista.recargar());

  return (
    <Tarjeta className="p-0">
      {lista.error && <Aviso tono="error" className="m-4">{lista.error}</Aviso>}
      {lista.cargando && !lista.datos ? (
        <Cargando />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <p className="text-sm text-slate-600">{fmtNumero(lista.datos?.total ?? 0)} cuentas sin leer en este período.</p>
            {periodoActivo && (lista.datos?.total ?? 0) > 0 && (
              <button className="boton-primario min-h-10 px-4 text-sm" onClick={() => setAvisando(true)}>
                <BellRing className="mr-1.5 size-4" aria-hidden="true" />
                Avisar a los operadores
              </button>
            )}
          </div>
          <table className="tabla mt-2">
            <thead>
              <tr>
                <th>N° cuenta</th>
                <th>Titular</th>
                <th>Dirección</th>
                <th>Medidor</th>
                <th className="text-right">Última lectura</th>
              </tr>
            </thead>
            <tbody>
              {lista.datos?.filas.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.numero_cuenta}</td>
                  <td>{c.titular}</td>
                  <td>{c.direccion}</td>
                  <td>{c.medidor}</td>
                  <td className="text-right tabular-nums">{fmtNumero(c.ultima_lectura)}</td>
                </tr>
              ))}
              {lista.datos?.filas.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    ¡No quedan cuentas pendientes!
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
      <AvisarPendientes abierto={avisando} periodoId={periodoId} periodoNombre={periodoNombre} alCerrar={() => setAvisando(false)} />
    </Tarjeta>
  );
}
