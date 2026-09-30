import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { llamarFuncion } from '@/lib/consultas';
import { config } from '@/lib/config';
import { fmtFechaHora, fmtNumero } from '@/lib/formato';
import { useAuth } from '@/auth/contexto';
import { useConsulta } from '@/hooks/useConsulta';
import { Aviso, Cargando, Encabezado, Insignia, Modal, Tarjeta } from '@/components/ui';
import type { VOperador } from '@/types/database';

type Mensaje = { tono: 'exito' | 'error'; texto: string };

export default function Operadores() {
  const auth = useAuth();
  const miId = auth.estado === 'con_sesion' ? auth.perfil.id : '';
  const [creando, setCreando] = useState(false);
  const [reseteando, setReseteando] = useState<VOperador | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const lista = useConsulta(async () => {
    const { data, error } = await supabase.from('v_operadores').select('*').order('activo', { ascending: false }).order('nombre');
    if (error) throw error;
    return data;
  }, []);

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
                    <td className="text-right tabular-nums">{fmtNumero(o.lecturas_periodo_activo)}</td>
                    <td className="text-right tabular-nums">{fmtNumero(o.lecturas_total)}</td>
                    <td className="whitespace-nowrap">{fmtFechaHora(o.ultima_lectura_at)}</td>
                    <td className="whitespace-nowrap text-right">
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

      <NuevoOperador
        abierto={creando}
        alCerrar={() => setCreando(false)}
        alCrear={(texto) => {
          setCreando(false);
          setMensaje({ tono: 'exito', texto });
          void lista.recargar();
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
