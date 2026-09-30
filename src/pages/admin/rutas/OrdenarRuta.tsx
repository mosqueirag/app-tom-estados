import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mensajeError, traerTodo } from '@/lib/consultas';
import { Aviso, Cargando, Modal } from '@/components/ui';
import type { Cuenta } from '@/types/database';

type Fila = Pick<Cuenta, 'id' | 'numero_cuenta' | 'titular' | 'direccion' | 'orden'>;

const porDireccion = (a: Fila, b: Fila) => a.direccion.localeCompare(b.direccion, 'es', { numeric: true, sensitivity: 'base' });

/** El admin arma el orden en que el operador recorre la ruta. */
export function OrdenarRuta({ ruta, alCerrar, alGuardar }: { ruta: string | null; alCerrar: () => void; alGuardar: (m: string) => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setFilas(null);
    setError(null);
    if (ruta === null) return;
    let vigente = true;
    traerTodo<Fila>((d, h) =>
      supabase
        .from('cuentas')
        .select('id, numero_cuenta, titular, direccion, orden')
        .eq('ruta', ruta)
        .eq('activa', true)
        .order('orden', { ascending: true, nullsFirst: false })
        .order('numero_cuenta')
        .range(d, h),
    )
      .then((f) => vigente && setFilas(f))
      .catch((e) => vigente && setError(mensajeError(e)));
    return () => {
      vigente = false;
    };
  }, [ruta]);

  function mover(i: number, delta: number) {
    setFilas((antes) => {
      if (!antes) return antes;
      const j = i + delta;
      if (j < 0 || j >= antes.length) return antes;
      const nuevas = [...antes];
      [nuevas[i], nuevas[j]] = [nuevas[j], nuevas[i]];
      return nuevas;
    });
  }

  async function guardar() {
    if (!filas || ruta === null) return;
    setGuardando(true);
    setError(null);
    const { error: e } = await supabase.rpc('ordenar_ruta', { p_ruta: ruta, p_cuenta_ids: filas.map((f) => f.id) });
    setGuardando(false);
    if (e) setError(mensajeError(e));
    else alGuardar(`Se guardó el recorrido de ${ruta || 'las cuentas sin ruta'}. Los operadores lo ven al descargar las cuentas.`);
  }

  return (
    <Modal titulo={`Recorrido de ${ruta || 'Sin ruta'}`} abierto={ruta !== null} alCerrar={alCerrar} ancho="max-w-2xl">
      {!filas && !error ? (
        <Cargando />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Poné las cuentas en el orden en que el operador camina la ruta. En el celular las ve en este orden, con un botón para abrir
            la dirección en Google Maps.
          </p>
          <button className="boton-chico" onClick={() => setFilas((f) => (f ? [...f].sort(porDireccion) : f))}>
            Ordenar por dirección
          </button>
          <ol className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {filas?.map((f, i) => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-8 text-right font-semibold tabular-nums text-slate-500">{i + 1}.</span>
                <span className="flex-1">
                  <span className="font-medium">{f.direccion}</span>
                  <span className="block text-xs text-slate-500">
                    {f.numero_cuenta} · {f.titular}
                  </span>
                </span>
                <button className="boton-chico" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${f.numero_cuenta}`}>
                  ↑
                </button>
                <button className="boton-chico" onClick={() => mover(i, 1)} disabled={i === filas.length - 1} aria-label={`Bajar ${f.numero_cuenta}`}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
          {error && <Aviso tono="error">{error}</Aviso>}
          <div className="flex justify-end gap-2">
            <button className="boton-secundario" onClick={alCerrar}>
              Cancelar
            </button>
            <button className="boton-primario" onClick={() => void guardar()} disabled={guardando || !filas?.length}>
              {guardando ? 'Guardando…' : 'Guardar orden'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
