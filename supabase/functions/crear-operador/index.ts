// POST /functions/v1/crear-operador
// Body: { nombre, password, email?, usuario?, rol? ('operador' | 'admin') }
// Hay que mandar email o usuario (nombre de usuario sin @).
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
  /** Cliente con la sesión del admin: así el historial de cambios registra quién fue. */
  usuario: SupabaseClient;
}

async function exigirAdmin(req: Request): Promise<ContextoAdmin> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceRole || !anon) {
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

  const usuario = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return { admin: userData.user, servicio, usuario };
}

// Dominio para convertir "nombre de usuario" en un email interno de Supabase
// (ej. "jperez" → "jperez@usuarios.lecturas.app"). Debe coincidir con
// VITE_DOMINIO_USUARIOS del frontend.
function dominioUsuarios(): string {
  return Deno.env.get('DOMINIO_USUARIOS') ?? 'usuarios.lecturas.app';
}

const PASSWORD_MINIMA = 6;

// --------------------------------------------------------------- Función
const USUARIO_VALIDO = /^[a-z0-9._-]{3,40}$/;
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('Método no permitido.', 405);

  try {
    const { servicio, usuario: sesionAdmin } = await exigirAdmin(req);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return error('Datos inválidos.');

    const nombre = String(body.nombre ?? '').trim();
    const password = String(body.password ?? '');
    const usuario = body.usuario ? String(body.usuario).trim().toLowerCase() : '';
    let email = body.email ? String(body.email).trim().toLowerCase() : '';
    const rol = body.rol === 'admin' ? 'admin' : 'operador';

    if (!nombre) return error('Ingresá el nombre del operador.');
    if (password.length < PASSWORD_MINIMA) {
      return error(`La contraseña debe tener al menos ${PASSWORD_MINIMA} caracteres.`);
    }
    if (!email && !usuario) return error('Ingresá un email o un nombre de usuario.');
    if (usuario && !USUARIO_VALIDO.test(usuario)) {
      return error('El usuario solo puede tener letras minúsculas, números, punto, guion y guion bajo (3 a 40 caracteres).');
    }
    if (!email) email = `${usuario}@${dominioUsuarios()}`;
    if (!EMAIL_VALIDO.test(email)) return error('El email no es válido.');

    const { data, error: crearError } = await servicio.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no se envía mail de confirmación
      user_metadata: { nombre, usuario: usuario || null },
    });

    if (crearError || !data.user) {
      const msg = crearError?.message ?? '';
      if (/already|registered|exists/i.test(msg)) {
        return error('Ya existe un usuario con ese email o nombre de usuario.', 409);
      }
      return error(`No se pudo crear el usuario: ${msg}`, 400);
    }

    // El trigger al_crear_usuario crea el perfil como 'operador' DESACTIVADO
    // (así un registro por fuera de la app nunca tiene acceso). Acá se activa.
    const { error: perfilError } = await sesionAdmin
      .from('perfiles')
      .update({ activo: true, rol })
      .eq('id', data.user.id);
    if (perfilError) return error('El usuario se creó pero no se pudo activar su perfil. Activalo desde Operadores.', 500);

    return json({
      id: data.user.id,
      nombre,
      email,
      usuario: usuario || null,
      rol,
      mensaje: rol === 'admin' ? 'Administrador creado.' : 'Operador creado.',
    }, 201);
  } catch (e) {
    if (e instanceof ErrorHttp) return error(e.message, e.status);
    console.error(e);
    return error('Error inesperado. Probá de nuevo.', 500);
  }
});
