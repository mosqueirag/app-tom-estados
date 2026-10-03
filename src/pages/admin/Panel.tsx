import { Link } from 'react-router';
import { supabase } from '@/lib/supabase';
import { fmtFecha, fmtFechaHora, fmtNumero } from '@/lib/formato';
import { useAlCambiarLecturas } from '@/components/AvisosLecturas';
import { AvanceOperadores } from '@/components/AvanceOperadores';
import { CargaRapida } from '@/components/CargaRapida';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, BarraProgreso, Cargando, Encabezado, Insignia, Tarjeta } from '@/components/ui';
import { BellRing, FileSpreadsheet, Keyboard, MessageSquare, Plus, Route, UserPlus, type LucideIcon } from 'lucide-react';
import type { Configuracion, Periodo, ResumenPeriodo, VLectura } from '@/types/database';

type DatosPanel = {
  periodo: Periodo | null;
  resumen: ResumenPeriodo | null;
  alertas: VLectura[];
  config: Configuracion | null;
  hoy: number;
  rutasSinOperador: string[];
};

const ACCESOS: { a: string; texto: string; Icono: LucideIcon }[] = [
  { a: '#carga-rapida', texto: 'Cargar lecturas', Icono: Keyboard },
  { a: '/admin/cuentas?accion=nueva', texto: 'Nueva cuenta', Icono: Plus },
  { a: '/admin/cuentas?accion=importar', texto: 'Importar Excel', Icono: FileSpreadsheet },
  { a: '/admin/rutas', texto: 'Rutas y operadores', Icono: Route },
  { a: '/admin/operadores?accion=nuevo', texto: 'Nuevo operador', Icono: UserPlus },
  { a: '/admin/mensajes', texto: 'Mensajes', Icono: MessageSquare },
  { a: '/admin/lecturas?vista=pendientes&avisar=1', texto: 'Avisar pendientes', Icono: BellRing },
];

export default function PanelAdmin() {
  const panel = useConsulta<DatosPanel>(async () => {
    const [{ data: periodo, error: e1 }, { data: config, error: e2 }] = await Promise.all([
      supabase.from('periodos').select('*').eq('activo', true).maybeSingle(),
      supabase.from('configuracion').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const { data: rutas } = await supabase.from('v_rutas').select('ruta, cuentas, operador_id, orden').neq('ruta', '').order('orden');
    const rutasSinOperador = (rutas ?? []).filter((r) => !r.operador_id).map((r) => r.ruta);
    if (!periodo) return { periodo: null, resumen: null, alertas: [], config, hoy: 0, rutasSinOperador };

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);
    const [{ data: resumen, error: e3 }, { data: alertas, error: e4 }, { count: hoy }] = await Promise.all([
      supabase.rpc('resumen_periodo', { p_periodo_id: periodo.id }),
      supabase
        .from('v_lecturas')
        .select('*')
        .eq('periodo_id', periodo.id)
        .or('alerta_menor_anterior.eq.true,alerta_consumo_anomalo.eq.true,alerta_sin_lectura.eq.true')
        .order('fecha_lectura', { ascending: false })
        .limit(8),
      supabase
        .from('lecturas')
        .select('id', { count: 'exact', head: true })
        .eq('periodo_id', periodo.id)
        .gte('fecha_lectura', inicioHoy.toISOString()),
    ]);
    if (e3) throw e3;
    if (e4) throw e4;
    return { periodo, resumen: resumen as unknown as ResumenPeriodo, alertas: alertas ?? [], config, hoy: hoy ?? 0, rutasSinOperador };
  }, []);
  useAlCambiarLecturas(() => void panel.recargar());

  if (panel.cargando && !panel.datos) return <Cargando />;
  if (panel.error) return <Aviso tono="error">{panel.error}</Aviso>;
  const { periodo, resumen, alertas, hoy, rutasSinOperador } = panel.datos!;
  const porcentaje = resumen && resumen.cuentas_activas ? Math.round((resumen.lecturas / resumen.cuentas_activas) * 100) : 0;

  return (
    <div className="space-y-6">
      <Encabezado titulo="Panel">
        <button className="boton-chico" onClick={() => void panel.recargar()}>
          Actualizar
        </button>
      </Encabezado>

      <div role="group" aria-label="Accesos rápidos" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {ACCESOS.filter((x) => periodo || x.a !== '#carga-rapida').map((x) =>
          x.a.startsWith('#') ? (
            <a
              key={x.a}
              href={x.a}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(x.a.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                document.querySelector<HTMLInputElement>('[aria-label="Número de cuenta para carga rápida"]')?.focus();
              }}
              className="acceso-rapido"
            >
              <span aria-hidden="true" className="icono-marca size-10"><x.Icono className="size-5" /></span>
              {x.texto}
            </a>
          ) : (
            <Link key={x.a} to={x.a} className="acceso-rapido">
              <span aria-hidden="true" className="icono-marca size-10"><x.Icono className="size-5" /></span>
              {x.texto}
            </Link>
          ),
        )}
      </div>

      {rutasSinOperador.length > 0 && (
        <Aviso tono="info">
          {rutasSinOperador.length === 1 ? 'La' : 'Hay'} {rutasSinOperador.length === 1 ? rutasSinOperador[0] : `${rutasSinOperador.length} rutas`}{' '}
          {rutasSinOperador.length === 1 ? 'no tiene' : 'sin'} operador.{' '}
          <Link to="/admin/rutas" className="font-medium underline">
            {rutasSinOperador.length === 1 ? 'Asignala' : 'Asignalas'} en Rutas
          </Link>
        </Aviso>
      )}

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
          <Tarjeta className="fondo-marca-suave border-marca-100">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm text-slate-500">Período activo</p>
                <h2 className="text-xl font-bold">{periodo.nombre}</h2>
              </div>
              <p className="text-sm text-slate-500">Desde el {fmtFecha(periodo.fecha_inicio)}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-lg">
                <strong>{fmtNumero(resumen.lecturas)}</strong> de <strong>{fmtNumero(resumen.cuentas_activas)}</strong> cuentas leídas
              </p>
              <p className="flex items-baseline gap-4">
                <span className="texto-marca text-4xl font-bold">{porcentaje}%</span>
                <span className="text-sm text-slate-600">
                  Hoy: <strong>{fmtNumero(hoy)}</strong> {hoy === 1 ? 'lectura' : 'lecturas'}
                </span>
              </p>
            </div>
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

          <div className="grid gap-6 lg:grid-cols-2">
            <CargaRapida periodoId={periodo.id} alGuardar={() => void panel.recargar()} />

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
          </div>

          <AvanceOperadores periodoId={periodo.id} />
        </>
      )}

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
