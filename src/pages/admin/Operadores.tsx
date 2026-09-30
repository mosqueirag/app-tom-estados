import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion } from '@/lib/consultas';
import { config } from '@/lib/config';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { useAuth } from '@/auth/contexto';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado, Insignia, Modal, Tarjeta } from '@/components/ui';
import type { VOperador, VRuta } from '@/types/database';
import { MandarMensaje } from '@/components/MandarMensaje';

type Mensaje = { tono: 'exito' | 'error'; texto: string };

export default function Operadores() {
  const auth = useAuth();
  const miId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const [creando, setCreando] = useState(false);
  const [reseteando, setReseteando] = useState<VOperador | null>(null);
  const [asignandoRutas, setAsignandoRutas] = useState<VOperador | null>(null);
  const [pasando, setPasando] = useState<VOperador | null>(null);
  const [escribiendo, setEscribiendo] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const lista = useConsulta(async () => {
    const { data, error } = await supabase.from('v_operadores').select('*').order('activo', { ascending: false }).order('nombre');
    if (error) throw error;
    return data;
  }, []);

  const rutas = useConsulta(async () => {
    const { data, error } = await supabase.from('v_rutas').select('*').neq('ruta', '').order('ruta');
    if (error) throw error;
    return data;
  }, []);

  const enviados = useConsulta(async () => {
    const { data, error } = await supabase.from('mensajes').select('*').order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    return data;
  }, []);
  const operadoresActivos = lista.datos?.filter((o) => o.activo && o.rol === 'operador') ?? [];

  const rutasDe = (id: string) => rutas.datos?.filter((r) => r.operador_id === id).map((r) => r.ruta) ?? [];

  async function cambiarActivo(o: VOperador) {
    const accion = o.activo ? 'desactivar' : 'activar';
    const aviso = o.activo ? '\n\nNo va a poder iniciar sesión ni sincronizar lecturas.' : '';
    if (!confirm(`¿Querés ${accion} a ${o.nombre}?${aviso}`)) return;
    setTrabajando(o.id);
    try {
      const r = await llamarFuncion<{ mensaje: string }>('gestionar-operador', { accion, operador_id: o.id });
      setMensaje({ tono: 'exito', texto: r.mensaje });
      void lista.recargar();
    } catch (e) {
      setMensaje({ tono: 'error', texto: (e as Error).message });
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <div>
      <Encabezado titulo="Operadores">
        <button className="boton-chico" onClick={() => setEscribiendo(true)}>
          Mandar mensaje
        </button>
        <button className="boton-primario min-h-9 px-4 text-sm" onClick={() => setCreando(true)}>
          Nuevo operador
        </button>
      </Encabezado>

      {mensaje && <Aviso tono={mensaje.tono} className="mb-4">{mensaje.texto}</Aviso>}
      {lista.error && <Aviso tono="error" className="mb-4">{lista.error}</Aviso>}

      <Tarjeta className="p-0">
        {lista.cargando && !lista.datos ? (
          <Cargando />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Ingresa con</th>
                  <th>Rol</th>
                  <th>Rutas</th>
                  <th className="text-right">Lecturas (período activo)</th>
                  <th className="text-right">Lecturas (total)</th>
                  <th>Última lectura</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.datos?.map((o) => (
                  <tr key={o.id} className={o.activo ? '' : 'text-slate-400'}>
                    <td className="font-medium">
                      {o.nombre} {!o.activo && <Insignia color="rojo">Desactivado</Insignia>}
                      {o.conflictos_pendientes > 0 && <Insignia color="amarillo">{o.conflictos_pendientes} conflicto(s)</Insignia>}
                    </td>
                    <td>{o.usuario ?? o.email}</td>
                    <td>{o.rol === 'admin' ? <Insignia color="violeta">Admin</Insignia> : 'Operador'}</td>
                    <td>
                      {o.rol === 'operador' && (
                        <div className="flex flex-wrap items-center gap-1">
                          {rutasDe(o.id).map((r) => (
                            <Insignia key={r}>{r}</Insignia>
                          ))}
                          {o.activo && (
                            <button className="text-sm text-marca-700 hover:underline" onClick={() => setAsignandoRutas(o)}>
                              {rutasDe(o.id).length ? 'Cambiar' : 'Asignar rutas'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{fmtNumero(o.lecturas_periodo_activo)}</td>
                    <td className="text-right tabular-nums">{fmtNumero(o.lecturas_total)}</td>
                    <td className="whitespace-nowrap">{fmtFechaHora(o.ultima_lectura_at)}</td>
                    <td className="whitespace-nowrap text-right">
                      {o.rol === 'operador' && (
                        <button className="boton-chico mr-2" onClick={() => setPasando(o)} aria-label={`Pasar pendientes de ${o.nombre}`}>
                          Pasar pendientes
                        </button>
                      )}
                      <button className="boton-chico mr-2" onClick={() => setReseteando(o)}>
                        Resetear contraseña
                      </button>
                      {o.id !== miId && (
                        <button className="boton-chico" disabled={trabajando === o.id} onClick={() => void cambiarActivo(o)}>
                          {o.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {!!enviados.datos?.length && (
        <Tarjeta className="mt-6">
          <h2 className="mb-2 font-semibold">Últimos mensajes enviados</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {enviados.datos.map((m) => (
              <li key={m.id} className="py-2">
                <p className="whitespace-pre-line">{m.texto}</p>
                <p className="text-xs text-slate-500">
                  {fmtFechaHora(m.created_at)} · para {m.para_id ? (lista.datos?.find((o) => o.id === m.para_id)?.nombre ?? 'un operador') : 'todos'}
                </p>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <MandarMensaje
        abierto={escribiendo}
        operadores={operadoresActivos}
        alCerrar={() => setEscribiendo(false)}
        alEnviar={(texto) => {
          setEscribiendo(false);
          setMensaje({ tono: 'exito', texto });
          void enviados.recargar();
        }}
      />
      <NuevoOperador
        abierto={creando}
        alCerrar={() => setCreando(false)}
        alCrear={(texto) => {
          setCreando(false);
          setMensaje({ tono: 'exito', texto });
          void lista.recargar();
        }}
      />
      <AsignarRutas
        operador={asignandoRutas}
        rutas={rutas.datos ?? []}
        alCerrar={() => setAsignandoRutas(null)}
        alGuardar={(texto) => {
          setAsignandoRutas(null);
          setMensaje({ tono: 'exito', texto });
          void rutas.recargar();
        }}
      />
      <PasarPendientes
        operador={pasando}
        operadores={lista.datos ?? []}
        alCerrar={() => setPasando(null)}
        alGuardar={(texto) => {
          setPasando(null);
          setMensaje({ tono: 'exito', texto });
          void rutas.recargar();
        }}
      />
      <ResetearPassword
        operador={reseteando}
        alCerrar={() => setReseteando(null)}
        alGuardar={(texto) => {
          setReseteando(null);
          setMensaje({ tono: 'exito', texto });
        }}
      />
    </div>
  );
}

function NuevoOperador({ abierto, alCerrar, alCrear }: { abierto: boolean; alCerrar: () => void; alCrear: (m: string) => void }) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<'usuario' | 'email'>('usuario');
  const [acceso, setAcceso] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<'operador' | 'admin'>('operador');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim() || !acceso.trim() || password.length < 6) {
      setError('Completá nombre, usuario o email, y una contraseña de al menos 6 caracteres.');
      return;
    }
    setGuardando(true);
    try {
      await llamarFuncion('crear-operador', {
        nombre: nombre.trim(),
        password,
        rol,
        ...(tipo === 'usuario' ? { usuario: acceso.trim().toLowerCase() } : { email: acceso.trim().toLowerCase() }),
      });
      alCrear(`${nombre.trim()} fue creado. Ya puede ingresar con "${acceso.trim().toLowerCase()}" y la contraseña que le asignaste.`);
      setNombre('');
      setAcceso('');
      setPassword('');
      setRol('operador');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo operador" abierto={abierto} alCerrar={alCerrar}>
      <form onSubmit={crear} className="space-y-4">
        <label className="block">
          <span className="etiqueta">Nombre y apellido</span>
          <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
        <div>
          <span className="etiqueta">Ingresa con</span>
          <div className="mb-2 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={tipo === 'usuario'} onChange={() => setTipo('usuario')} /> Nombre de usuario
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={tipo === 'email'} onChange={() => setTipo('email')} /> Email
            </label>
          </div>
          <input
            className="campo"
            value={acceso}
            onChange={(e) => setAcceso(e.target.value)}
            autoCapitalize="none"
            placeholder={tipo === 'usuario' ? 'ej. jperez' : 'ej. juan@empresa.com'}
            aria-label={tipo === 'usuario' ? 'Nombre de usuario' : 'Email'}
          />
          {tipo === 'usuario' && (
            <span className="mt-1 block text-xs text-slate-500">
              Letras minúsculas, números, punto o guion. Internamente se guarda como {acceso.trim().toLowerCase() || 'usuario'}@{config.dominioUsuarios}.
            </span>
          )}
        </div>
        <label className="block">
          <span className="etiqueta">Contraseña inicial</span>
          <input className="campo" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <span className="mt-1 block text-xs text-slate-500">Mínimo 6 caracteres. Pasásela al operador.</span>
        </label>
        <label className="block">
          <span className="etiqueta">Rol</span>
          <select className="campo" value={rol} onChange={(e) => setRol(e.target.value as 'operador' | 'admin')}>
            <option value="operador">Operador (toma lecturas)</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" className="boton-primario" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetearPassword({ operador, alCerrar, alGuardar }: { operador: VOperador | null; alCerrar: () => void; alGuardar: (m: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!operador) return;
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const r = await llamarFuncion<{ mensaje: string }>('gestionar-operador', { accion: 'resetear_password', operador_id: operador.id, password });
      setPassword('');
      alGuardar(r.mensaje);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Nueva contraseña para ${operador?.nombre ?? ''}`} abierto={operador !== null} alCerrar={alCerrar}>
      <form onSubmit={guardar} className="space-y-4">
        <label className="block">
          <span className="etiqueta">Nueva contraseña</span>
          <input className="campo" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" className="boton-primario" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AsignarRutas({
  operador,
  rutas,
  alCerrar,
  alGuardar,
}: {
  operador: VOperador | null;
  rutas: VRuta[];
  alCerrar: () => void;
  alGuardar: (m: string) => void;
}) {
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [abiertoPara, setAbiertoPara] = useState<string | null>(null);

  // Al abrir, marcar las rutas que ya tiene
  if (operador && abiertoPara !== operador.id) {
    setAbiertoPara(operador.id);
    setElegidas(new Set(rutas.filter((r) => r.operador_id === operador.id).map((r) => r.ruta)));
    setError(null);
  }
  if (!operador && abiertoPara !== null) setAbiertoPara(null);

  function alternar(ruta: string) {
    setElegidas((antes) => {
      const nuevas = new Set(antes);
      if (nuevas.has(ruta)) nuevas.delete(ruta);
      else nuevas.add(ruta);
      return nuevas;
    });
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!operador) return;
    const tenia = rutas.filter((r) => r.operador_id === operador.id).map((r) => r.ruta);
    const agregar = [...elegidas].filter((r) => !tenia.includes(r));
    const quitar = tenia.filter((r) => !elegidas.has(r));
    if (!agregar.length && !quitar.length) return alCerrar();
    setGuardando(true);
    setError(null);
    try {
      const mensajes: string[] = [];
      if (agregar.length) {
        const r = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { rutas: agregar, operador_id: operador.id });
        mensajes.push(r.mensaje);
      }
      if (quitar.length) {
        await llamarFuncion('asignar-cuentas', { rutas: quitar, operador_id: null });
        mensajes.push(`${quitar.join(', ')} ${quitar.length === 1 ? 'quedó' : 'quedaron'} sin asignar.`);
      }
      alGuardar(mensajes.join(' '));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Rutas de ${operador?.nombre ?? ''}`} abierto={operador !== null} alCerrar={alCerrar}>
      <form onSubmit={guardar} className="space-y-4">
        {rutas.length === 0 ? (
          <p className="text-sm text-slate-600">Todavía no hay rutas. Cargá la ruta de cada cuenta en Cuentas o desde el Excel.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">Marcá las rutas que lee. Al guardar le llega un aviso al celular con las rutas nuevas.</p>
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {rutas.map((r) => {
                const deOtro = r.operador_id && r.operador_id !== operador?.id ? r.operador_nombre : null;
                return (
                  <li key={r.ruta}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                      <input type="checkbox" className="size-5" checked={elegidas.has(r.ruta)} onChange={() => alternar(r.ruta)} />
                      <span className="flex-1">
                        <span className="font-medium">{r.ruta}</span>{' '}
                        <span className="text-sm text-slate-500">({fmtNumero(r.cuentas)} cuentas)</span>
                      </span>
                      {deOtro && <span className="text-xs text-slate-500">Hoy: {deOtro}</span>}
                      {r.repartida && <Insignia color="amarillo">Repartida</Insignia>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          <button type="submit" className="boton-primario" disabled={guardando || rutas.length === 0}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Pasa a otro operador las cuentas que este todavía no leyó (por ejemplo, si faltó). */
function PasarPendientes({
  operador,
  operadores,
  alCerrar,
  alGuardar,
}: {
  operador: VOperador | null;
  operadores: VOperador[];
  alCerrar: () => void;
  alGuardar: (m: string) => void;
}) {
  const [destino, setDestino] = useState('');
  const [pendientes, setPendientes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const opciones = operadores.filter((o) => o.activo && o.rol === 'operador' && o.id !== operador?.id);

  useEffect(() => {
    setDestino('');
    setPendientes(null);
    setError(null);
    if (!operador) return;
    let vigente = true;
    void (async () => {
      const { data: periodo } = await supabase.from('periodos').select('id').eq('activo', true).maybeSingle();
      if (!periodo) {
        if (vigente) setError('No hay un período abierto.');
        return;
      }
      const { count, error: e } = await supabase
        .rpc('cuentas_pendientes', { p_periodo_id: periodo.id }, { count: 'exact', head: true })
        .eq('operador_id', operador.id);
      if (!vigente) return;
      if (e) setError(e.message);
      else setPendientes(count ?? 0);
    })();
    return () => {
      vigente = false;
    };
  }, [operador]);

  async function pasar(e: FormEvent) {
    e.preventDefault();
    if (!operador || !destino) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await llamarFuncion<{ mensaje: string }>('asignar-cuentas', { reasignar_de: operador.id, operador_id: destino });
      alGuardar(r.mensaje);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Pasar pendientes de ${operador?.nombre ?? ''}`} abierto={operador !== null} alCerrar={alCerrar}>
      <form onSubmit={pasar} className="space-y-4">
        {pendientes === null && !error ? (
          <Cargando />
        ) : pendientes === 0 ? (
          <p className="text-slate-600">{operador?.nombre} no tiene cuentas pendientes en el período abierto.</p>
        ) : pendientes !== null ? (
          <>
            <p className="text-slate-600">
              {operador?.nombre} tiene <strong>{fmtNumero(pendientes)}</strong> {pendientes === 1 ? 'cuenta pendiente' : 'cuentas pendientes'} en el período
              abierto. Las que ya leyó se quedan con él.
            </p>
            <label className="block">
              <span className="etiqueta">Pasárselas a</span>
              <select className="campo" value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">Elegí un operador</option>
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-500">Al que las recibe le llega un aviso al celular para descargarlas.</p>
          </>
        ) : null}
        {error && <Aviso tono="error">{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <button type="button" className="boton-secundario" onClick={alCerrar}>
            Cancelar
          </button>
          {!!pendientes && (
            <button type="submit" className="boton-primario" disabled={guardando || !destino}>
              {guardando ? 'Pasando…' : `Pasar ${pendientes === 1 ? 'la cuenta' : `${fmtNumero(pendientes)} cuentas`}`}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
