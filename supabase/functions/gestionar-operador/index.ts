// POST /functions/v1/gestionar-operador
// Body:
//   { accion: 'desactivar',        operador_id }
//   { accion: 'activar',           operador_id }
//   { accion: 'resetear_password', operador_id, password }
//
// Archivo autocontenido: se puede pegar tal cual en el editor de Edge Functions
// del panel de Supabase, o publicar con `npx supabase functions deploy`.
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';

// ------------------------------------------------------------------ CORS
// Encabezados CORS para que la app (Netlify o localhost) pueda llamar a las funciones.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function error(mensaje: string, status = 400): Response {
  return json({ error: mensaje }, status);
}

// ------------------------------------------------ Verificación de admin
// Verifica que quien llama sea un administrador activo y devuelve un cliente
// con la clave service_role. Esa clave SOLO existe acá (variables de entorno
// de Supabase Edge Functions), nunca en el frontend.

class ErrorHttp extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

interface ContextoAdmin {
  admin: User;
  servicio: SupabaseClient;
}

async function exigirAdmin(req: Request): Promise<ContextoAdmin> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) {
    throw new ErrorHttp(500, 'La función no está configurada (faltan variables de entorno).');
  }

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new ErrorHttp(401, 'Tenés que iniciar sesión.');

  const servicio = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Valida el token contra Supabase Auth (no alcanza con decodificarlo).
  const { data: userData, error: userError } = await servicio.auth.getUser(token);
  if (userError || !userData.user) throw new ErrorHttp(401, 'Sesión inválida o vencida. Volvé a iniciar sesión.');

  const { data: perfil, error: perfilError } = await servicio
    .from('perfiles')
    .select('rol, activo')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (perfilError) throw new ErrorHttp(500, 'No se pudo verificar tu perfil.');
  if (!perfil || perfil.rol !== 'admin' || !perfil.activo) {
    throw new ErrorHttp(403, 'Solo un administrador puede hacer esto.');
  }

  return { admin: userData.user, servicio };
}

// Dominio para convertir "nombre de usuario" en un email interno de Supabase
// (ej. "jperez" → "jperez@usuarios.lecturas.app"). Debe coincidir con
// VITE_DOMINIO_USUARIOS del frontend.
function dominioUsuarios(): string {
  return Deno.env.get('DOMINIO_USUARIOS') ?? 'usuarios.lecturas.app';
}

const PASSWORD_MINIMA = 6;

// --------------------------------------------------------------- Función
// Un bloqueo "para siempre" en Supabase Auth: no puede iniciar sesión ni
// renovar la sesión guardada en el celular.
const BLOQUEO_INDEFINIDO = '876000h';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('Método no permitido.', 405);

  try {
    const { admin, servicio } = await exigirAdmin(req);

    const body = await req.json().catch(() => null);
    const accion = body?.accion;
    const operadorId = String(body?.operador_id ?? '');

    if (!/^[0-9a-f-]{36}$/i.test(operadorId)) return error('Falta el operador.');
    if (operadorId === admin.id && accion !== 'resetear_password') {
      return error('No podés desactivarte ni reactivarte a vos mismo.');
    }

    const { data: perfil } = await servicio.from('perfiles').select('id, nombre').eq('id', operadorId).maybeSingle();
    if (!perfil) return error('El operador no existe.', 404);

    switch (accion) {
      case 'desactivar': {
        const { error: e1 } = await servicio.from('perfiles').update({ activo: false }).eq('id', operadorId);
        if (e1) return error('No se pudo desactivar el operador.', 500);
        const { error: e2 } = await servicio.auth.admin.updateUserById(operadorId, { ban_duration: BLOQUEO_INDEFINIDO });
        if (e2) return error('Se desactivó el perfil pero no se pudo bloquear el acceso.', 500);
        return json({ mensaje: `${perfil.nombre} fue desactivado.` });
      }
      case 'activar': {
        const { error: e1 } = await servicio.from('perfiles').update({ activo: true }).eq('id', operadorId);
        if (e1) return error('No se pudo activar el operador.', 500);
        const { error: e2 } = await servicio.auth.admin.updateUserById(operadorId, { ban_duration: 'none' });
        if (e2) return error('Se activó el perfil pero no se pudo desbloquear el acceso.', 500);
        return json({ mensaje: `${perfil.nombre} fue activado.` });
      }
      case 'resetear_password': {
        const password = String(body?.password ?? '');
        if (password.length < PASSWORD_MINIMA) {
          return error(`La contraseña debe tener al menos ${PASSWORD_MINIMA} caracteres.`);
        }
        const { error: e1 } = await servicio.auth.admin.updateUserById(operadorId, { password });
        if (e1) return error(`No se pudo cambiar la contraseña: ${e1.message}`, 500);
        return json({ mensaje: `Se cambió la contraseña de ${perfil.nombre}.` });
      }
      default:
        return error('Acción inválida. Usá desactivar, activar o resetear_password.');
    }
  } catch (e) {
    if (e instanceof ErrorHttp) return error(e.message, e.status);
    console.error(e);
    return error('Error inesperado. Probá de nuevo.', 500);
  }
});
