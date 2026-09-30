// POST /functions/v1/asignar-cuentas
// Body: { operador_id: uuid | null, ruta?: string, cuenta_ids?: uuid[] }
//   ruta       → asigna todas las cuentas activas de esa ruta
//   cuenta_ids → asigna esas cuentas
//   operador_id null → las deja sin asignar
// Después avisa al operador con una notificación push en su celular.
//
// Archivo autocontenido: se puede pegar tal cual en el editor de Edge Functions
// del panel de Supabase, o publicar con `npx supabase functions deploy`.
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

// ------------------------------------------------------------------ CORS
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
// La clave service_role SOLO existe acá (variables de entorno de Supabase
// Edge Functions), nunca en el frontend.
class ErrorHttp extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

async function exigirAdmin(req: Request): Promise<{ admin: User; servicio: SupabaseClient }> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) throw new ErrorHttp(500, 'La función no está configurada (faltan variables de entorno).');

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new ErrorHttp(401, 'Tenés que iniciar sesión.');

  const servicio = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await servicio.auth.getUser(token);
  if (userError || !userData.user) throw new ErrorHttp(401, 'Sesión inválida o vencida. Volvé a iniciar sesión.');

  const { data: perfil, error: perfilError } = await servicio
    .from('perfiles')
    .select('rol, activo')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (perfilError) throw new ErrorHttp(500, 'No se pudo verificar tu perfil.');
  if (!perfil || perfil.rol !== 'admin' || !perfil.activo) throw new ErrorHttp(403, 'Solo un administrador puede hacer esto.');

  return { admin: userData.user, servicio };
}

// ------------------------------------------------------------ Avisos push
type Suscripcion = { id: number; endpoint: string; p256dh: string; auth: string };

async function enviarAvisos(servicio: SupabaseClient, perfilId: string, aviso: Record<string, string>) {
  const { data: config } = await servicio.from('configuracion_push').select('*').eq('id', 1).maybeSingle();
  if (!config) return { enviados: 0, celulares: 0, motivo: 'Los avisos push no están configurados.' };

  const { data: subs } = await servicio
    .from('suscripciones_push')
    .select('id, endpoint, p256dh, auth')
    .eq('perfil_id', perfilId);
  const lista = (subs ?? []) as Suscripcion[];
  if (!lista.length) return { enviados: 0, celulares: 0, motivo: null };

  webpush.setVapidDetails(config.contacto, config.vapid_publica, config.vapid_privada);
  let enviados = 0;
  const vencidas: number[] = [];
  await Promise.all(
    lista.map(async (s) => {
      try {
        const d = webpush.generateRequestDetails(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(aviso),
          { TTL: 60 * 60 * 24, urgency: 'high' },
        );
        const r = await fetch(d.endpoint, { method: d.method, headers: d.headers, body: d.body });
        if (r.ok) enviados++;
        else if (r.status === 404 || r.status === 410) vencidas.push(s.id); // el celular dio de baja la suscripción
        else console.error('push', r.status, await r.text());
      } catch (e) {
        console.error('push', e);
      }
    }),
  );
  if (vencidas.length) await servicio.from('suscripciones_push').delete().in('id', vencidas);
  return { enviados, celulares: lista.length, motivo: null };
}

// --------------------------------------------------------------- Función
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('Método no permitido.', 405);

  try {
    const { servicio } = await exigirAdmin(req);
    const body = await req.json().catch(() => null);

    const operadorId = body?.operador_id ? String(body.operador_id) : null;
    const ruta = typeof body?.ruta === 'string' ? body.ruta.trim() : null;
    const cuentaIds: string[] = Array.isArray(body?.cuenta_ids) ? body.cuenta_ids.map(String) : [];

    if (operadorId && !UUID.test(operadorId)) return error('Operador inválido.');
    if (ruta === null && !cuentaIds.length) return error('Indicá la ruta o las cuentas a asignar.');
    if (cuentaIds.some((id) => !UUID.test(id))) return error('Cuenta inválida.');

    let operadorNombre = '';
    if (operadorId) {
      const { data: op } = await servicio.from('perfiles').select('nombre, activo').eq('id', operadorId).maybeSingle();
      if (!op) return error('El operador no existe.', 404);
      if (!op.activo) return error(`${op.nombre} está desactivado. Activalo antes de asignarle cuentas.`);
      operadorNombre = op.nombre;
    }

    let consulta = servicio.from('cuentas').update({ operador_id: operadorId });
    consulta = ruta !== null ? consulta.eq('ruta', ruta).eq('activa', true) : consulta.in('id', cuentaIds);
    const { data: cambiadas, error: e1 } = await consulta.select('id');
    if (e1) return error(`No se pudo asignar: ${e1.message}`, 500);
    const cantidad = cambiadas?.length ?? 0;

    const que = ruta !== null ? (ruta ? `la ${ruta}` : 'las cuentas sin ruta') : `${cantidad} cuenta${cantidad === 1 ? '' : 's'}`;
    if (!operadorId) {
      return json({ actualizadas: cantidad, mensaje: `Quedaron sin asignar ${cantidad} cuenta${cantidad === 1 ? '' : 's'}.` });
    }
    if (!cantidad) return json({ actualizadas: 0, mensaje: 'No había cuentas para asignar.' });

    const aviso = {
      titulo: 'Tenés cuentas nuevas para leer',
      cuerpo:
        ruta !== null
          ? `Te asignaron ${que} (${cantidad} cuenta${cantidad === 1 ? '' : 's'}). Tocá para descargarlas.`
          : `Te asignaron ${que}. Tocá para descargarlas.`,
      url: '/operador?descargar=1',
      tag: 'asignacion',
    };
    const r = await enviarAvisos(servicio, operadorId, aviso);

    let detalle: string;
    if (r.motivo) detalle = r.motivo;
    else if (!r.celulares) detalle = `${operadorNombre} todavía no activó los avisos en su celular: avisale vos.`;
    else if (!r.enviados) detalle = `No se pudo avisar a ${operadorNombre} en su celular.`;
    else detalle = `Se avisó a ${operadorNombre} en su celular.`;

    return json({
      actualizadas: cantidad,
      avisos_enviados: r.enviados,
      mensaje: `Se asignaron ${cantidad} cuenta${cantidad === 1 ? '' : 's'} a ${operadorNombre}. ${detalle}`,
    });
  } catch (e) {
    if (e instanceof ErrorHttp) return error(e.message, e.status);
    console.error(e);
    return error('Error inesperado. Probá de nuevo.', 500);
  }
});
