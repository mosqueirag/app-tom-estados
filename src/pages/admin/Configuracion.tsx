import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError } from '@/lib/consultas';
import { fmtNumero } from '@/lib/formato';
import { descargarCopiaDeSeguridad } from '@/lib/copiaSeguridad';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado, Tarjeta } from '@/components/ui';
import type { Configuracion as Config } from '@/types/database';

/** Ajustes generales de la app (antes estaban al pie del Panel). */
export default function Configuracion() {
  const config = useConsulta(async () => {
    const { data, error } = await supabase.from('configuracion').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return data;
  }, []);

  return (
    <div className="space-y-6">
      <Encabezado titulo="Configuración" />
      {config.error && <Aviso tono="error">{config.error}</Aviso>}
      {config.cargando && !config.datos && <Cargando />}
      {config.datos && <Umbral config={config.datos} alGuardar={() => void config.recargar()} />}
      {config.datos && <FotoObligatoria config={config.datos} alGuardar={() => void config.recargar()} />}
      <CopiaDeSeguridad />
    </div>
  );
}

function Umbral({ config, alGuardar }: { config: Config; alGuardar: () => void }) {
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

function FotoObligatoria({ config, alGuardar }: { config: Config; alGuardar: () => void }) {
  const [estado, setEstado] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cambiar(valor: boolean) {
    setGuardando(true);
    const { error } = await supabase.from('configuracion').update({ foto_obligatoria: valor }).eq('id', 1);
    setGuardando(false);
    if (error) setEstado({ tono: 'error', texto: mensajeError(error) });
    else {
      setEstado({ tono: 'exito', texto: 'Guardado. Los celulares lo toman al descargar las cuentas.' });
      alGuardar();
    }
  }

  return (
    <Tarjeta>
      <h2 className="font-semibold">Foto del medidor</h2>
      <p className="mt-1 text-sm text-slate-600">
        Cada lectura puede llevar una foto del medidor y la ubicación GPS. Las ves en Lecturas y en el Mapa.
      </p>
      <label className="mt-3 flex items-center gap-2">
        <input type="checkbox" className="size-5" checked={config.foto_obligatoria} disabled={guardando} onChange={(e) => void cambiar(e.target.checked)} />
        <span>Exigir foto en cada lectura</span>
      </label>
      {estado && (
        <Aviso tono={estado.tono} className="mt-3">
          {estado.texto}
        </Aviso>
      )}
    </Tarjeta>
  );
}

function CopiaDeSeguridad() {
  const [estado, setEstado] = useState<{ tono: 'exito' | 'error'; texto: string } | null>(null);
  const [descargando, setDescargando] = useState(false);

  async function descargar() {
    setDescargando(true);
    setEstado(null);
    try {
      const n = await descargarCopiaDeSeguridad();
      setEstado({ tono: 'exito', texto: `Copia descargada: ${fmtNumero(n.cuentas)} cuentas y ${fmtNumero(n.lecturas)} lecturas. Guardala en un lugar seguro.` });
    } catch (e) {
      setEstado({ tono: 'error', texto: `No se pudo armar la copia: ${mensajeError(e)}` });
    } finally {
      setDescargando(false);
    }
  }

  return (
    <Tarjeta>
      <h2 className="font-semibold">Copia de seguridad</h2>
      <p className="mt-1 text-sm text-slate-600">
        Descarga un Excel con todas las cuentas, períodos, lecturas, conflictos, correcciones y operadores. Conviene bajarla al cerrar
        cada período.
      </p>
      <button className="boton-secundario mt-3" onClick={() => void descargar()} disabled={descargando}>
        {descargando ? 'Armando la copia…' : 'Descargar copia de seguridad'}
      </button>
      {estado && (
        <Aviso tono={estado.tono} className="mt-3">
          {estado.texto}
        </Aviso>
      )}
    </Tarjeta>
  );
}
