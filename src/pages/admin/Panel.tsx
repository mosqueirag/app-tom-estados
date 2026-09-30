import { useState } from 'react';
import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/consultas';
import { fmtFecha, fmtFechaHora, fmtNumero } from '@/lib/formato';
import { useAlCambiarLecturas } from '@/components/AvisosLecturas';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, BarraProgreso, Cargando, Encabezado, Insignia, Tarjeta } from '@/components/ui';
import type { Configuracion, Periodo, ResumenPeriodo, VLectura } from '@/types/database';

type DatosPanel = {
  periodo: Periodo | null;
  resumen: ResumenPeriodo | null;
  alertas: VLectura[];
  config: Configuracion | null;
};

export default function PanelAdmin() {
  const panel = useConsulta<DatosPanel>(async () => {
    const [{ data: periodo, error: e1 }, { data: config, error: e2 }] = await Promise.all([
      supabase.from('periodos').select('*').eq('activo', true).maybeSingle(),
      supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    if (!periodo) return { periodo: null, resumen: null, alertas: [], config };

    const [{ data: resumen, error: e3 }, { data: alertas, error: e4 }] = await Promise.all([
      supabase.rpc('resumen_periodo', { p_periodo_id: periodo.id }),
      supabase
        .from('v_lecturas')
        .select('*')
        .eq('periodo_id', periodo.id)
        .or('alerta_menor_anterior.eq.true,alerta_consumo_anomalo.eq.true,alerta_sin_lectura.eq.true')
        .order('fecha_lectura', { ascending: false })
        .limit(8),
    ]);
    if (e3) throw e3;
    if (e4) throw e4;
    return { periodo, resumen: resumen as unknown as ResumenPeriodo, alertas: alertas ?? [], config };
  }, []);
  useAlCambiarLecturas(() => void panel.recargar());

  if (panel.cargando && !panel.datos) return <Cargando />;
  if (panel.error) return <Aviso tono="error">{panel.error}</Aviso>;
  const { periodo, resumen, alertas, config } = panel.datos!;

  return (
    <div className="space-y-6">
      <Encabezado titulo="Panel">
        <button className="boton-chico" onClick={() => void panel.recargar()}>
          Actualizar
        </button>
      </Encabezado>

      {!periodo || !resumen ? (
        <Tarjeta>
          <p className="font-medium">No hay un período abierto.</p>
          <p className="mt-1 text-sm text-slate-600">Abrí uno para que los operadores puedan cargar lecturas.</p>
          <Link to="/admin/periodos" className="boton-primario mt-4">
            Ir a Períodos
          </Link>
        </Tarjeta>
      ) : (
        <>
          <Tarjeta>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm text-slate-500">Período activo</p>
                <h2 className="text-xl font-bold">{periodo.nombre}</h2>
              </div>
              <p className="text-sm text-slate-500">Desde el {fmtFecha(periodo.fecha_inicio)}</p>
            </div>
            <p className="mt-4 text-lg">
              <strong>{fmtNumero(resumen.lecturas)}</strong> de <strong>{fmtNumero(resumen.cuentas_activas)}</strong> cuentas leídas
            </p>
            <div className="mt-2">
              <BarraProgreso valor={resumen.lecturas} total={resumen.cuentas_activas} />
            </div>
          </Tarjeta>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Dato titulo="Pendientes" valor={resumen.pendientes} a="/admin/lecturas?vista=pendientes" />
            <Dato titulo="Sin lectura" valor={resumen.sin_lectura} a="/admin/lecturas?alerta=sin_lectura" alerta={resumen.sin_lectura > 0} />
            <Dato titulo="Menor a la anterior" valor={resumen.alertas_menor_anterior} a="/admin/lecturas?alerta=menor_anterior" alerta={resumen.alertas_menor_anterior > 0} />
            <Dato titulo="Consumo anómalo" valor={resumen.alertas_consumo_anomalo} a="/admin/lecturas?alerta=consumo_anomalo" alerta={resumen.alertas_consumo_anomalo > 0} />
            <Dato titulo="Conflictos" valor={resumen.conflictos_pendientes} a="/admin/lecturas?vista=conflictos" alerta={resumen.conflictos_pendientes > 0} />
          </div>

          <Tarjeta>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Últimas alertas</h2>
              <Link to="/admin/lecturas?alerta=cualquiera" className="text-sm text-marca-700 hover:underline">
                Ver todas
              </Link>
            </div>
            {alertas.length === 0 ? (
              <p className="text-sm text-slate-500">No hay alertas en este período.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {alertas.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <strong>{a.numero_cuenta}</strong> · {a.titular}
                      <span className="block text-xs text-slate-500">
                        <time dateTime={a.fecha_lectura}>{fmtFechaHora(a.fecha_lectura)}</time>
                        {a.operador_nombre ? ` · ${a.operador_nombre}` : ''}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {a.alerta_menor_anterior && <Insignia color="rojo">Menor a la anterior</Insignia>}
                      {a.alerta_consumo_anomalo && <Insignia color="amarillo">Consumo {fmtNumero(a.consumo)}</Insignia>}
                      {a.alerta_sin_lectura && <Insignia>Sin lectura{a.observacion ? `: ${a.observacion}` : ''}</Insignia>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </>
      )}

      {config && <Umbral config={config} alGuardar={() => void panel.recargar()} />}
    </div>
  );
}

function Dato({ titulo, valor, a, alerta = false }: { titulo: string; valor: number; a: string; alerta?: boolean }) {
  return (
    <Link to={a} className={`rounded-2xl border p-4 shadow-sm transition hover:shadow ${alerta ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-sm text-slate-600">{titulo}</p>
      <p className="text-2xl font-bold">{fmtNumero(valor)}</p>
    </Link>
  );
}

function Umbral({ config, alGuardar }: { config: Configuracion; alGuardar: () => void }) {
  const [valor, setValor] = useState(String(config.umbral_consumo_anomalo));
  const [estado, setEstado] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const n = Number(valor.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setEstado({ tono: 'error', texto: 'Ingresá un número mayor a 0 (por ejemplo 3).' });
      return;
    }
    setGuardando(true);
    const { error } = await supabase.from('configuracion').update({ umbral_consumo_anomalo: n }).eq('id', 1);
    setGuardando(false);
    if (error) setEstado({ tono: 'error', texto: mensajeError(error) });
    else {
      setEstado({ tono: 'exito', texto: 'Umbral guardado. Los celulares lo toman al descargar las cuentas.' });
      alGuardar();
    }
  }

  return (
    <Tarjeta>
      <h2 className="font-semibold">Alerta de consumo anómalo</h2>
      <p className="mt-1 text-sm text-slate-600">
        Se avisa cuando el consumo supera este número de veces el último consumo de la cuenta.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label>
          <span className="etiqueta">Veces el último consumo</span>
          <input className="campo w-32" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Umbral de consumo anómalo" />
        </label>
        <button className="boton-primario" onClick={() => void guardar()} disabled={guardando}>
          Guardar
        </button>
      </div>
      {estado && (
        <Aviso tono={estado.tono} className="mt-3">
          {estado.texto}
        </Aviso>
      )}
    </Tarjeta>
  );
}
