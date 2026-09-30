// POST /functions/v1/asignar-cuentas
// Body: { operador_id: uuid | null, ruta?: string, rutas?: string[], cuenta_ids?: uuid[] }
//   ruta       → asigna todas las cuentas activas de esa ruta
//   rutas      → lo mismo con varias rutas a la vez (un solo aviso)
//   cuenta_ids → asigna esas cuentas
//   operador_id null → las deja sin asignar
// Después avisa al operador con una notificación push en su celular.
//
// Body: { avisar: 'nuevas' | 'actualizadas', cuenta_ids: uuid[] }
//   No cambia nada: avisa a cada operador de esas cuentas que tiene datos
//   nuevos para descargar (cuentas creadas o modificadas por el admin).
//
// Body: { reasignar_de: uuid, operador_id: uuid }
//   Pasa a operador_id las cuentas que reasignar_de todavía no leyó en el
//   período abierto (por ejemplo, si faltó) y le avisa al que las recibe.
//
// Body: { mensaje: string, para_id: uuid | null }
//   Guarda un mensaje corto para un operador (o para todos si para_id es
//   null) y se lo manda como notificación push.
//
// Los cambios en cuentas y mensajes se hacen con la sesión del admin (no con
// service_role) para que el historial de cambios registre quién los hizo.
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

async function exigirAdmin(req: Request): Promise<{ admin: User; servicio: SupabaseClient; usuario: SupabaseClient }> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceRole || !anon) throw new ErrorHttp(500, 'La función no está configurada (faltan variables de entorno).');

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

  // Cliente con la sesión del admin: respeta RLS y deja su nombre en la auditoría
  const usuario = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { admin: userData.user, servicio, usuario };
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
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// Avisa a los operadores de estas cuentas que tienen datos nuevos.
async function avisarCambios(servicio: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const tipo = body.avisar === 'nuevas' ? 'nuevas' : 'actualizadas';
  const ids: string[] = Array.isArray(body.cuenta_ids) ? body.cuenta_ids.map(String) : [];
  if (!ids.length) return json({ avisos_enviados: 0, mensaje: '' });
  if (ids.some((id) => !UUID.test(id))) return error('Cuenta inválida.');

  const porOperador = new Map<string, { numeros: string[] }>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error: e } = await servicio
      .from('cuentas')
      .select('numero_cuenta, operador_id')
      .in('id', ids.slice(i, i + 500))
      .eq('activa', true)
      .not('operador_id', 'is', null);
    if (e) return error(`No se pudo avisar: ${e.message}`, 500);
    for (const c of data ?? []) {
      const g = porOperador.get(c.operador_id) ?? { numeros: [] };
      g.numeros.push(c.numero_cuenta);
      porOperador.set(c.operador_id, g);
    }
  }
  if (!porOperador.size) return json({ avisos_enviados: 0, mensaje: '' });

  const { data: perfiles } = await servicio.from('perfiles').select('id, nombre').in('id', [...porOperador.keys()]);
  const nombres = new Map((perfiles ?? []).map((p) => [p.id as string, p.nombre as string]));

  const avisados: string[] = [];
  const sinAvisos: string[] = [];
  let enviados = 0;
  for (const [operadorId, { numeros }] of porOperador) {
    const n = numeros.length;
    const cuales = n === 1 ? `la cuenta ${numeros[0]}` : plural(n, 'cuenta', 'cuentas');
    const aviso =
      tipo === 'nuevas'
        ? { titulo: 'Tenés cuentas nuevas para leer', cuerpo: `Te asignaron ${cuales}. Tocá para descargar${n === 1 ? 'la' : 'las'}.` }
        : { titulo: 'Se actualizaron tus cuentas', cuerpo: `El administrador modificó ${cuales}. Tocá para descargar los datos nuevos.` };
    const r = await enviarAvisos(servicio, operadorId, { ...aviso, url: '/operador?descargar=1', tag: 'asignacion' });
    enviados += r.enviados;
    (r.enviados ? avisados : sinAvisos).push(nombres.get(operadorId) ?? 'un operador');
  }

  const partes: string[] = [];
  if (avisados.length) partes.push(`Se avisó en el celular a ${avisados.join(', ')}.`);
  if (sinAvisos.length) partes.push(`${sinAvisos.join(', ')} no tiene${sinAvisos.length === 1 ? '' : 'n'} los avisos activados: avisale vos.`);
  return json({ avisos_enviados: enviados, mensaje: partes.join(' ') });
}

async function operadorActivo(servicio: SupabaseClient, id: string): Promise<{ nombre: string } | Response> {
  const { data: op } = await servicio.from('perfiles').select('nombre, activo, rol').eq('id', id).maybeSingle();
  if (!op) return error('El operador no existe.', 404);
  if (!op.activo) return error(`${op.nombre} está desactivado. Activalo antes de asignarle cuentas.`);
  return { nombre: op.nombre };
}

function detalleAviso(r: { enviados: number; celulares: number; motivo: string | null }, nombre: string): string {
  if (r.motivo) return r.motivo;
  if (!r.celulares) return `${nombre} todavía no activó los avisos en su celular: avisale vos.`;
  if (!r.enviados) return `No se pudo avisar a ${nombre} en su celular.`;
  return `Se avisó a ${nombre} en su celular.`;
}

// Pasa las cuentas pendientes de un operador a otro.
async function reasignarPendientes(servicio: SupabaseClient, usuario: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const de = String(body.reasignar_de ?? '');
  const a = String(body.operador_id ?? '');
  if (!UUID.test(de) || !UUID.test(a)) return error('Operador inválido.');
  if (de === a) return error('Elegí otro operador.');

  const destino = await operadorActivo(servicio, a);
  if (destino instanceof Response) return destino;
  const { data: origen } = await servicio.from('perfiles').select('nombre').eq('id', de).maybeSingle();
  const nombreOrigen = origen?.nombre ?? 'el operador';

  const { data: periodo } = await servicio.from('periodos').select('id').eq('activo', true).maybeSingle();
  if (!periodo) return error('No hay un período abierto.');

  const ids: string[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error: e } = await usuario
      .rpc('cuentas_pendientes', { p_periodo_id: periodo.id })
      .select('id, operador_id') // PostgREST solo filtra por columnas elegidas
      .eq('operador_id', de)
      .range(desde, desde + 999);
    if (e) return error(`No se pudieron buscar las pendientes: ${e.message}`, 500);
    const lista = (data ?? []) as unknown as { id: string }[];
    ids.push(...lista.map((c) => c.id));
    if (lista.length < 1000) break;
  }
  if (!ids.length) return json({ actualizadas: 0, mensaje: `${nombreOrigen} no tiene cuentas pendientes.` });

  let cantidad = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error: e } = await usuario
      .from('cuentas')
      .update({ operador_id: a })
      .in('id', ids.slice(i, i + 300))
      .eq('operador_id', de)
      .select('id');
    if (e) return error(`No se pudieron pasar las cuentas: ${e.message}`, 500);
    cantidad += data?.length ?? 0;
  }

  const r = await enviarAvisos(servicio, a, {
    titulo: 'Tenés cuentas nuevas para leer',
    cuerpo: `Te pasaron ${plural(cantidad, 'cuenta pendiente', 'cuentas pendientes')} de ${nombreOrigen}. Tocá para descargarlas.`,
    url: '/operador?descargar=1',
    tag: 'asignacion',
  });
  return json({
    actualizadas: cantidad,
    avisos_enviados: r.enviados,
    mensaje: `Se pasaron ${plural(cantidad, 'cuenta pendiente', 'cuentas pendientes')} de ${nombreOrigen} a ${destino.nombre}. ${detalleAviso(r, destino.nombre)}`,
  });
}

// Mensaje corto del admin a un operador o a todos.
async function mandarMensaje(servicio: SupabaseClient, usuario: SupabaseClient, admin: User, body: Record<string, unknown>): Promise<Response> {
  const texto = String(body.mensaje ?? '').trim();
  const para = body.para_id ? String(body.para_id) : null;
  if (!texto) return error('Escribí el mensaje.');
  if (texto.length > 500) return error('El mensaje es muy largo (máximo 500 letras).');
  if (para && !UUID.test(para)) return error('Operador inválido.');

  let destinatarios: { id: string; nombre: string }[];
  if (para) {
    const op = await operadorActivo(servicio, para);
    if (op instanceof Response) return op;
    destinatarios = [{ id: para, nombre: op.nombre }];
  } else {
    const { data } = await servicio.from('perfiles').select('id, nombre').eq('rol', 'operador').eq('activo', true);
    destinatarios = (data ?? []) as { id: string; nombre: string }[];
  }

  const { data: guardado, error: e } = await usuario
    .from('mensajes')
    .insert({ autor_id: admin.id, para_id: para, texto })
    .select('id, created_at')
    .single();
  if (e) return error(`No se pudo guardar el mensaje: ${e.message}`, 500);

  const avisados: string[] = [];
  const sinAvisos: string[] = [];
  let enviados = 0;
  let motivo: string | null = null;
  for (const d of destinatarios) {
    const r = await enviarAvisos(servicio, d.id, {
      titulo: 'Mensaje del administrador',
      cuerpo: texto.length > 180 ? `${texto.slice(0, 177)}...` : texto,
      url: '/operador?mensajes=1',
      tag: `mensaje-${guardado.id}`,
    });
    motivo ??= r.motivo;
    enviados += r.enviados;
    (r.enviados ? avisados : sinAvisos).push(d.nombre);
  }

  let detalle: string;
  if (motivo) detalle = motivo;
  else if (!destinatarios.length) detalle = 'No hay operadores activos.';
  else {
    const partes: string[] = [];
    if (avisados.length) partes.push(`Les llegó al celular a ${avisados.join(', ')}.`);
    if (sinAvisos.length) partes.push(`${sinAvisos.join(', ')} no tiene${sinAvisos.length === 1 ? '' : 'n'} los avisos activados: lo ve${sinAvisos.length === 1 ? '' : 'n'} al abrir la app.`);
    detalle = partes.join(' ');
  }
  return json({ id: guardado.id, avisos_enviados: enviados, mensaje: `Mensaje enviado. ${detalle}` });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('Método no permitido.', 405);

  try {
    const { admin, servicio, usuario } = await exigirAdmin(req);
    const body = await req.json().catch(() => null);

    if (body?.avisar) return await avisarCambios(servicio, body);
    if (body?.reasignar_de) return await reasignarPendientes(servicio, usuario, body);
    if (typeof body?.mensaje === 'string') return await mandarMensaje(servicio, usuario, admin, body);

    const operadorId = body?.operador_id ? String(body.operador_id) : null;
    const rutas: string[] | null = Array.isArray(body?.rutas)
      ? [...new Set<string>(body.rutas.map((r: unknown) => String(r).trim()))]
      : typeof body?.ruta === 'string'
        ? [body.ruta.trim()]
        : null;
    const cuentaIds: string[] = Array.isArray(body?.cuenta_ids) ? body.cuenta_ids.map(String) : [];

    if (operadorId && !UUID.test(operadorId)) return error('Operador inválido.');
    if ((rutas === null || !rutas.length) && !cuentaIds.length) return error('Indicá la ruta o las cuentas a asignar.');
    if (cuentaIds.some((id) => !UUID.test(id))) return error('Cuenta inválida.');

    let operadorNombre = '';
    if (operadorId) {
      const op = await operadorActivo(servicio, operadorId);
      if (op instanceof Response) return op;
      operadorNombre = op.nombre;
    }

    let consulta = usuario.from('cuentas').update({ operador_id: operadorId });
    if (rutas !== null && rutas.length > 1 && rutas.includes('')) return error('Asigná las cuentas sin ruta por separado.');
    if (rutas === null) consulta = consulta.in('id', cuentaIds);
    else consulta = (rutas.length === 1 ? consulta.eq('ruta', rutas[0]) : consulta.in('ruta', rutas)).eq('activa', true);
    const { data: cambiadas, error: e1 } = await consulta.select('id');
    if (e1) return error(`No se pudo asignar: ${e1.message}`, 500);
    const cantidad = cambiadas?.length ?? 0;

    const nombres = (rutas ?? []).map((r) => (r ? r : 'las cuentas sin ruta'));
    const que =
      rutas !== null
        ? nombres.length === 1
          ? rutas[0] ? `la ${rutas[0]}` : nombres[0]
          : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`
        : `${cantidad} cuenta${cantidad === 1 ? '' : 's'}`;
    if (!operadorId) {
      return json({ actualizadas: cantidad, mensaje: `Quedaron sin asignar ${cantidad} cuenta${cantidad === 1 ? '' : 's'}.` });
    }
    if (!cantidad) return json({ actualizadas: 0, mensaje: 'No había cuentas para asignar.' });

    const aviso = {
      titulo: 'Tenés cuentas nuevas para leer',
      cuerpo:
        rutas !== null
          ? `Te asignaron ${que} (${cantidad} cuenta${cantidad === 1 ? '' : 's'}). Tocá para descargarlas.`
          : `Te asignaron ${que}. Tocá para descargarlas.`,
      url: '/operador?descargar=1',
      tag: 'asignacion',
    };
    const r = await enviarAvisos(servicio, operadorId, aviso);

    const detalle = detalleAviso(r, operadorNombre);

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
