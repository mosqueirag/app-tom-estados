import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtFechaHora } from '@/lib/formato';
import { useConsulta, useDemorado } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado, Insignia, Paginador, Tarjeta } from '@/components/ui';
import type { Auditoria, Json } from '@/types/database';
import { limpiarBusqueda } from './Cuentas';

const POR_PAGINA = 50;

const CAMPOS: Record<string, string> = {
  numero_cuenta: 'N° de cuenta',
  titular: 'Titular',
  direccion: 'Dirección',
  medidor: 'Medidor',
  ruta: 'Ruta',
  operador_id: 'Operador',
  activa: 'Activa',
  activo: 'Activo',
  nombre: 'Nombre',
  email: 'Email',
  usuario: 'Usuario',
  rol: 'Rol',
  observaciones: 'Observaciones',
};
// En las altas se muestran solo los datos que importan
const EN_ALTA: Record<string, string[]> = {
  cuentas: ['titular', 'direccion', 'medidor', 'ruta', 'operador_id'],
  perfiles: ['usuario', 'email', 'rol'],
};

const ACCIONES = {
  alta: { texto: 'Alta', color: 'verde' },
  cambio: { texto: 'Cambio', color: 'azul' },
  baja: { texto: 'Baja', color: 'rojo' },
} as const;

/** Quién creó, cambió o dio de baja cada cuenta y cada operador. */
export default function Historial() {
  const [tabla, setTabla] = useState<'' | 'cuentas' | 'perfiles'>('');
  const [accion, setAccion] = useState<'' | 'alta' | 'cambio' | 'baja'>('');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(0);
  const q = limpiarBusqueda(useDemorado(busqueda));

  const nombres = useConsulta(async () => {
    const { data, error } = await supabase.from('perfiles').select('id, nombre');
    if (error) throw error;
    return new Map((data ?? []).map((p) => [p.id, p.nombre]));
  }, []);

  const lista = useConsulta(async () => {
    let consulta = supabase.from('auditoria').select('*', { count: 'exact' });
    if (tabla) consulta = consulta.eq('tabla', tabla);
    if (accion) consulta = consulta.eq('accion', accion);
    if (q) consulta = consulta.or(`descripcion.ilike.%${q}%,usuario_nombre.ilike.%${q}%`);
    const { data, error, count } = await consulta
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (error) throw error;
    return { filas: (data ?? []) as Auditoria[], total: count ?? 0 };
  }, [tabla, accion, q, pagina]);

  function valor(campo: string, v: Json | undefined): string {
    if (v === null || v === undefined || v === '') return '(vacío)';
    if (campo === 'operador_id') return nombres.datos?.get(String(v)) ?? 'Operador borrado';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (campo === 'rol') return v === 'admin' ? 'Administrador' : 'Operador';
    return String(v);
  }

  function detalle(a: Auditoria) {
    if (a.accion === 'cambio' || (a.accion === 'baja' && Object.values(a.cambios).every(Array.isArray))) {
      return Object.entries(a.cambios)
        .filter(([, v]) => Array.isArray(v))
        .map(([campo, v]) => {
          const [antes, despues] = v as Json[];
          return (
            <li key={campo}>
              <span className="text-slate-500">{CAMPOS[campo] ?? campo}:</span> {valor(campo, antes)} → <strong>{valor(campo, despues)}</strong>
            </li>
          );
        });
    }
    return (EN_ALTA[a.tabla] ?? [])
      .filter((c) => a.cambios[c] !== undefined && a.cambios[c] !== null && a.cambios[c] !== '')
      .map((c) => (
        <li key={c}>
          <span className="text-slate-500">{CAMPOS[c] ?? c}:</span> {valor(c, a.cambios[c])}
        </li>
      ));
  }

  const cambiar = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPagina(0);
  };

  return (
    <div>
      <Encabezado titulo="Historial de cambios" />
      <Tarjeta className="p-0">
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <input
            className="campo max-w-md flex-1"
            type="search"
            placeholder="Buscar por cuenta, titular, operador o quién lo hizo"
            value={busqueda}
            onChange={(e) => cambiar(setBusqueda)(e.target.value)}
            aria-label="Buscar en el historial"
          />
          <select className="campo w-auto" value={tabla} onChange={(e) => cambiar(setTabla)(e.target.value as typeof tabla)} aria-label="Qué">
            <option value="">Cuentas y operadores</option>
            <option value="cuentas">Solo cuentas</option>
            <option value="perfiles">Solo operadores</option>
          </select>
          <select className="campo w-auto" value={accion} onChange={(e) => cambiar(setAccion)(e.target.value as typeof accion)} aria-label="Acción">
            <option value="">Todas las acciones</option>
            <option value="alta">Altas</option>
            <option value="cambio">Cambios</option>
            <option value="baja">Bajas</option>
          </select>
        </div>
        {lista.error && (
          <Aviso tono="error" className="m-4">
            {lista.error}
          </Aviso>
        )}
        {lista.cargando && !lista.datos ? (
          <Cargando />
        ) : lista.datos?.filas.length === 0 ? (
          <p className="p-6 text-center text-slate-500">Todavía no hay cambios registrados{q || tabla || accion ? ' con este filtro' : ''}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Quién</th>
                  <th>Acción</th>
                  <th>Sobre</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {lista.datos?.filas.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap">{fmtFechaHora(a.fecha)}</td>
                    <td>{a.usuario_nombre ?? <span className="text-slate-500">Sistema</span>}</td>
                    <td>
                      <Insignia color={ACCIONES[a.accion].color}>{ACCIONES[a.accion].texto}</Insignia>
                    </td>
                    <td>
                      <span className="block text-xs text-slate-500">{a.tabla === 'cuentas' ? 'Cuenta' : 'Operador'}</span>
                      <span className="font-medium">{a.descripcion}</span>
                    </td>
                    <td>
                      <ul className="space-y-0.5 text-sm">{detalle(a)}</ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="p-4">
          <Paginador pagina={pagina} porPagina={POR_PAGINA} total={lista.datos?.total ?? 0} alCambiar={setPagina} />
        </div>
      </Tarjeta>
    </div>
  );
}
