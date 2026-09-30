import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion, mensajeError } from '@/lib/consultas';
import { parsearNumero } from '@/lib/formato';
import { Aviso, Modal } from '@/components/ui';
import type { Cuenta } from '@/types/database';

export type OperadorOpcion = { id: string; nombre: string };
export type RutaOpcion = { ruta: string; operador_id: string | null };

type Props = {
  cuenta: Cuenta | 'nueva' | null;
  periodoAbierto: string | null;
  operadores: OperadorOpcion[];
  rutas: RutaOpcion[];
  alCerrar: () => void;
  alGuardar: (mensaje: string) => void;
};

const VACIO = { numero_cuenta: '', titular: '', direccion: '', medidor: '', ultima_lectura: '', ruta: '', operador_id: '', activa: true };

export function FormularioCuenta({ cuenta, periodoAbierto, operadores, rutas, alCerrar, alGuardar }: Props) {
  const esNueva = cuenta === 'nueva';
  const [datos, setDatos] = useState(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Si el admin eligió el operador a mano, cambiar la ruta ya no lo pisa.
  const [operadorElegido, setOperadorElegido] = useState(false);

  useEffect(() => {
    setError(null);
    setOperadorElegido(false);
    if (cuenta && cuenta !== 'nueva') {
      setDatos({
        numero_cuenta: cuenta.numero_cuenta,
        titular: cuenta.titular,
        direccion: cuenta.direccion,
        medidor: cuenta.medidor,
        ultima_lectura: cuenta.ultima_lectura === null ? '' : String(cuenta.ultima_lectura),
        ruta: cuenta.ruta,
        operador_id: cuenta.operador_id ?? '',
        activa: cuenta.activa,
      });
    } else setDatos(VACIO);
  }, [cuenta]);

  const lecturaBloqueada = !esNueva && Boolean(periodoAbierto);
  const set = (campo: keyof typeof VACIO) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDatos((d) => ({ ...d, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  function cambiarRuta(e: ChangeEvent<HTMLInputElement>) {
    const ruta = e.target.value;
    const operador = rutas.find((r) => r.ruta === ruta.trim().replace(/\s+/g, ' '))?.operador_id;
    setDatos((d) => ({ ...d, ruta, ...(operador && !operadorElegido ? { operador_id: operador } : {}) }));
  }

  function cambiarOperador(e: ChangeEvent<HTMLSelectElement>) {
    setOperadorElegido(true);
    setDatos((d) => ({ ...d, operador_id: e.target.value }));
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const numero = datos.numero_cuenta.trim();
    if (!numero || !datos.titular.trim() || !datos.direccion.trim() || !datos.medidor.trim()) {
      setError('Completá número de cuenta, titular, dirección y medidor.');
      return;
    }
    const lectura = datos.ultima_lectura.trim() === '' ? null : parsearNumero(datos.ultima_lectura);
    if (datos.ultima_lectura.trim() !== '' && (lectura === null || lectura < 0)) {
      setError('La última lectura debe ser un número mayor o igual a 0.');
      return;
    }
    if (esNueva && operadores.length > 0 && !datos.operador_id) {
      setError('Elegí el operador que va a leer esta cuenta.');
      return;
    }

    const fila = {
      numero_cuenta: numero,
      titular: datos.titular.trim(),
      direccion: datos.direccion.trim(),
      medidor: datos.medidor.trim(),
      ruta: datos.ruta.trim().replace(/\s+/g, ' '),
      activa: datos.activa,
      ...(lecturaBloqueada ? {} : { ultima_lectura: lectura }),
    };

    setGuardando(true);
    setError(null);
    const { data: guardada, error: err } = esNueva
      ? await supabase.from('cuentas').insert(fila).select('id').single()
      : await supabase.from('cuentas').update(fila).eq('id', (cuenta as Cuenta).id).select('id').single();
    if (err || !guardada) {
      setGuardando(false);
      setError(mensajeError(err));
      return;
    }

    // El operador se asigna aparte: si cambió, se le avisa al celular.
    // Si no cambió pero se modificaron los datos, también se le avisa.
    let extra = '';
    const original = esNueva ? null : (cuenta as Cuenta);
    const antes = original?.operador_id ?? '';
    const cambiaronDatos =
      original !== null &&
      (Object.keys(fila) as (keyof typeof fila)[]).some((k) => fila[k] !== original[k as keyof Cuenta]);
    if (datos.operador_id !== antes) {
      try {
        const r = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', {
          cuenta_ids: [guardada.id],
          operador_id: datos.operador_id || null,
        });
        extra = ' ' + r.mensaje;
      } catch (e2) {
        extra = ` No se pudo asignar el operador: ${(e2 as Error).message}`;
      }
    } else if (datos.operador_id && cambiaronDatos) {
      try {
        const r = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { avisar: 'actualizadas', cuenta_ids: [guardada.id] });
        if (r.mensaje) extra = ' ' + r.mensaje;
      } catch (e2) {
        extra = ` No se pudo avisar al operador: ${(e2 as Error).message}`;
      }
    }
    setGuardando(false);
    alGuardar((esNueva ? `Cuenta ${numero} creada.` : `Cuenta ${numero} actualizada.`) + extra);
  }

  return (
    <Modal titulo={esNueva ? 'Nueva cuenta' : 'Editar cuenta'} abierto={cuenta !== null} alCerrar={alCerrar}>
      <form onSubmit={guardar} className="space-y-4">
        <label className="block">
          <span className="etiqueta">Número de cuenta</span>
          <input className="campo" value={datos.numero_cuenta} onChange={set('numero_cuenta')} />
        </label>
        <label className="block">
          <span className="etiqueta">Titular</span>
          <input className="campo" value={datos.titular} onChange={set('titular')} />
        </label>
        <label className="block">
          <span className="etiqueta">Dirección</span>
          <input className="campo" value={datos.direccion} onChange={set('direccion')} />
        </label>
        <label className="block">
          <span className="etiqueta">Medidor</span>
          <input className="campo" value={datos.medidor} onChange={set('medidor')} />
        </label>
        <label className="block">
          <span className="etiqueta">Última lectura</span>
          <input
            className="campo disabled:bg-slate-100"
            inputMode="decimal"
            value={datos.ultima_lectura}
            onChange={set('ultima_lectura')}
            disabled={lecturaBloqueada}
          />
          {lecturaBloqueada && (
            <span className="mt-1 block text-xs text-slate-500">
              No se puede cambiar mientras el período "{periodoAbierto}" está abierto. Se actualiza sola al cerrarlo.
            </span>
          )}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="etiqueta">Ruta</span>
            <input className="campo" list="rutas-existentes" value={datos.ruta} onChange={cambiarRuta} placeholder="ej. Ruta 1" />
            <datalist id="rutas-existentes">
              {rutas.filter((r) => r.ruta).map((r) => (
                <option key={r.ruta} value={r.ruta} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="etiqueta">Operador</span>
            <select className="campo" value={datos.operador_id} onChange={cambiarOperador}>
              <option value="">{esNueva ? 'Elegí un operador' : 'Sin asignar (la ven todos)'}</option>
              {datos.operador_id && !operadores.some((o) => o.id === datos.operador_id) && (
                <option value={datos.operador_id}>Operador desactivado</option>
              )}
              {operadores.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        {datos.operador_id && (
          <p className="-mt-2 text-xs text-slate-500">Al guardar, al operador le llega un aviso al celular para descargar la cuenta.</p>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-5" checked={datos.activa} onChange={set('activa')} />
          <span>Cuenta activa (aparece en los celulares)</span>
        </label>
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" className="boton-primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
