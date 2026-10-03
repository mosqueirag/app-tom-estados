// Fase 17: aviso de cuentas pendientes a cada operador y chat interno admin <-> operador.
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import { execFileSync } from 'child_process';
const requireG = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = requireG('playwright');
const requireL = createRequire(import.meta.url);
const XLSX = requireL('xlsx');

const SECRETO = 'secreto-de-prueba-de-al-menos-32-caracteres!!';
const PGRST = 'http://localhost:3000';
const BASE = 'http://localhost:4173';
const CAPT = process.env.CAPTURAS;
const TMP = '/home/claude/build/e2e/tmp'; fs.mkdirSync(TMP, { recursive: true });
const psql = (sql) => execFileSync('psql', ['-h', '/home/claude/pgtest', '-p', '54329', '-U', 'postgres', '-d', 'e2e', '-tAq', '-c', sql]).toString().trim();

const USERS = {
  'admin@x.com': 'aaaaaaaa-0000-0000-0000-000000000001',
  'jperez@usuarios.lecturas.app': 'bbbbbbbb-0000-0000-0000-000000000002',
  'mgomez@usuarios.lecturas.app': 'bbbbbbbb-0000-0000-0000-000000000003',
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, role: 'authenticated', aud: 'authenticated', email })}`;
  return `${cuerpo}.${crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}
function sesion(email) {
  const id = USERS[email]; const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: jwt(id, email), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + email,
    user: { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-30' } };
}
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const quien = (req) => JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url'));

async function mock(route) {
  const req = route.request(); const url = new URL(req.url());
  if (url.pathname === '/auth/v1/token') {
    const body = req.postDataJSON();
    const email = url.searchParams.get('grant_type') === 'password' ? body.email : body.refresh_token.slice(2);
    if (!USERS[email] || (body.password && body.password !== 'secreto')) return json(route, 400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return json(route, 200, sesion(email));
  }
  if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (url.pathname === '/auth/v1/user') return json(route, 200, sesion(quien(req).email).user);
  if (url.pathname.startsWith('/rest/v1/')) {
    const destino = PGRST + url.pathname.replace('/rest/v1', '') + url.search;
    const headers = { ...req.headers() }; delete headers.host;
    const r = await route.fetch({ url: destino, headers });
    return route.fulfill({ response: r });
  }
  // Storage simulado (notas de voz)
  if (url.pathname.startsWith('/storage/v1/object/sign/') && req.method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'audio/webm', body: subidas.at(-1)?.cuerpo ?? Buffer.alloc(0) });
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/')) {
    firmadas.push(url.pathname);
    const path = url.pathname.replace('/storage/v1/object/sign/', '');
    return json(route, 200, { signedURL: `/object/sign/${path}?token=t` });
  }
  if (url.pathname.startsWith('/storage/v1/object/')) {
    subidas.push({ path: url.pathname.replace('/storage/v1/object/', ''), cuerpo: req.postDataBuffer(), tipo: req.headers()['content-type'] });
    return json(route, 200, { Key: url.pathname.slice('/storage/v1/object/'.length) });
  }
  // asignar-cuentas simulada: los cambios se hacen contra PostgREST con la sesión
  // del admin, igual que la función real (así el historial registra quién fue)
  if (url.pathname === '/functions/v1/asignar-cuentas') {
    const b = req.postDataJSON(); llamadas.push(b);
    const auth = { Authorization: req.headers().authorization, 'Content-Type': 'application/json' };
    if (b.reasignar_de) {
      const periodo = psql('select id from periodos where activo');
      const r = await fetch(`${PGRST}/rpc/cuentas_pendientes?operador_id=eq.${b.reasignar_de}&select=id`, { method: 'POST', headers: auth, body: JSON.stringify({ p_periodo_id: periodo }) });
      const ids = (await r.json()).map((c) => c.id);
      const u = await fetch(`${PGRST}/cuentas?id=in.(${ids.join(',')})&operador_id=eq.${b.reasignar_de}`, { method: 'PATCH', headers: { ...auth, Prefer: 'return=representation' }, body: JSON.stringify({ operador_id: b.operador_id }) });
      const n = (await u.json()).length;
      return json(route, 200, { actualizadas: n, mensaje: `Se pasaron ${n} cuentas pendientes.` });
    }
    if (b.mensaje !== undefined) {
      const r = await fetch(`${PGRST}/mensajes`, { method: 'POST', headers: { ...auth, Prefer: 'return=representation' }, body: JSON.stringify({ autor_id: quien(req).sub, para_id: b.para_id, texto: b.mensaje }) });
      const fila = await r.json();
      if (!r.ok) return json(route, 400, { error: fila.message });
      return json(route, 200, { id: fila[0].id, mensaje: 'Mensaje enviado.' });
    }
    if (b.avisar) return json(route, 200, { avisos_enviados: 0, mensaje: `Aviso a ${b.cuenta_ids.length}.` });
    if (b.rutas || b.ruta !== undefined) {
      const rutas = b.rutas ?? [b.ruta];
      if (rutas[0] !== '') {
        const r = await fetch(`${PGRST}/rutas?on_conflict=nombre`, { method: 'POST', headers: { ...auth, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rutas.map((nombre) => ({ nombre, operador_id: b.operador_id }))) });
        if (!r.ok) return json(route, 400, { error: await r.text() });
      }
      const lista = encodeURIComponent(`(${rutas.map((r) => `"${r}"`).join(',')})`);
      const u = await fetch(`${PGRST}/cuentas?ruta=in.${lista}&activa=eq.true`, { method: 'PATCH', headers: { ...auth, Prefer: 'return=representation' }, body: JSON.stringify({ operador_id: b.operador_id }) });
      const n = (await u.json()).length;
      return json(route, 200, { actualizadas: n, mensaje: `${rutas.join(', ')}: ${n} cuentas.` });
    }
    return json(route, 400, { error: 'modo no simulado' });
  }
  return json(route, 404, { message: 'sin mock ' + url.pathname });
}
const llamadas = [];
const subidas = [];
const firmadas = [];
const resultados = [];
const ok = (n, c, extra = '') => resultados.push(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);
const intentar = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message.split('\n')[0]); console.log('DBG', n, page.url(), (await page.locator('main').textContent({ timeout: 2000 }).catch(() => '')).slice(0, 400)); } };

process.on('unhandledRejection', () => undefined);
const JUAN = 'bbbbbbbb-0000-0000-0000-000000000002';
const MARIA = 'bbbbbbbb-0000-0000-0000-000000000003';
psql(`insert into periodos (nombre) select 'Octubre 2026' where not exists (select 1 from periodos where activo);
      update rutas set operador_id='${JUAN}' where nombre='Ruta 1'; update rutas set operador_id='${MARIA}' where nombre='Ruta 2';
      update cuentas set ruta='Ruta 1' where numero_cuenta in ('10001','10002','10003');
      update cuentas set ruta='Ruta 2' where numero_cuenta in ('10004','10005');`);
const ACTIVO = psql('select id from periodos where activo');
psql(`set session_replication_role = replica;
  insert into lecturas (id, periodo_id, cuenta_id, operador_id, lectura_anterior, lectura_actual, fecha_lectura)
  select gen_random_uuid(), '${ACTIVO}', id, '${JUAN}', 100, 150, now() from cuentas where numero_cuenta = '10001';`);
const PEND_JUAN = psql(`select count(*) from cuentas c where c.activa and c.operador_id='${JUAN}' and not exists (select 1 from lecturas l where l.cuenta_id=c.id)`);
const PEND_MARIA = psql(`select count(*) from cuentas c where c.activa and c.operador_id='${MARIA}' and not exists (select 1 from lecturas l where l.cuenta_id=c.id)`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errores = [];
async function contexto(movil) {
  const ctx = await browser.newContext(movil ? { viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 900 }, locale: 'es-AR' });
  await ctx.route('http://supabase.test/**', mock);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errores.push(e.message)); p.on('dialog', (d) => d.accept());
  return p;
}
async function entrar(p, usuario, destino) {
  await p.goto(BASE + '/login');
  await p.getByLabel('Email o usuario').fill(usuario); await p.getByLabel('Contraseña').fill('secreto');
  await p.getByRole('button', { name: 'Ingresar' }).click(); await p.waitForURL(BASE + destino);
}
const admin = await contexto(false);
const page = admin; // para intentar()
const cel = await contexto(true);
await entrar(admin, 'admin@x.com', '/admin');

await intentar('Avisar pendientes', async () => {
  await admin.getByRole('group', { name: 'Accesos rápidos' }).getByRole('link', { name: 'Avisar pendientes' }).click();
  const d = admin.getByRole('dialog', { name: 'Avisar cuentas pendientes' });
  await d.getByRole('list', { name: 'Operadores con pendientes' }).waitFor();
  const filas = await d.getByRole('list', { name: 'Operadores con pendientes' }).getByRole('listitem').allTextContents();
  ok('Lista cada operador con sus pendientes', filas.length === 2 && filas.some((f) => f.includes(`Juan Pérez · ${PEND_JUAN} pendientes`)) && filas.some((f) => f.includes(`María Gómez · ${PEND_MARIA} pendientes`)), filas.join(' | '));
  ok('Muestra cómo llega el mensaje', (await d.textContent()).includes('Hola María: te quedan') || (await d.textContent()).includes('Hola Juan: te quedan'));
  ok('Avisa de las cuentas sin operador', (await d.textContent()).includes('no tienen operador'));
  if (CAPT) await admin.screenshot({ path: CAPT + '/avisar-pendientes.png' });
  await d.getByRole('button', { name: 'Avisar a 2 operadores' }).click();
  await d.getByRole('button', { name: 'Listo' }).waitFor();
  const guardados = psql(`select string_agg(para_id::text, ',' order by para_id) from mensajes where texto like '%pendiente%'`);
  ok('Guarda un aviso para cada operador', guardados === `${JUAN},${MARIA}`, guardados);
  ok('El aviso lista las cuentas', psql(`select texto from mensajes where para_id='${JUAN}'`).includes('10002'));
  await d.getByRole('button', { name: 'Listo' }).click();
});

await intentar('Chat: el admin escribe', async () => {
  await admin.getByRole('navigation').getByRole('link', { name: 'Mensajes' }).click();
  await admin.getByRole('button', { name: /^Conversación con Juan Pérez/ }).click();
  const log = admin.getByRole('log', { name: 'Conversación con Juan Pérez' });
  await log.getByText(/te quedan/).waitFor();
  ok('Muestra el aviso de pendientes en la conversación', true);
  await admin.getByLabel('Escribir mensaje').fill('Hola Juan, ¿cómo vas?');
  await admin.getByLabel('Escribir mensaje').press('Enter');
  await log.getByText('Hola Juan, ¿cómo vas?').waitFor();
  ok('Enter envía y queda en la conversación', psql(`select count(*) from mensajes where para_id='${JUAN}' and texto='Hola Juan, ¿cómo vas?'`) === '1');
});

await intentar('Chat: el operador lee y responde', async () => {
  await entrar(cel, 'jperez', '/operador');
  await cel.getByRole('link', { name: 'Chat: 2 sin leer' }).waitFor();
  ok('Celular: el botón de chat muestra los no leídos', true);
  const tarjeta = cel.getByRole('region', { name: 'Mensajes del administrador' });
  await tarjeta.waitFor();
  await tarjeta.getByRole('link', { name: 'Responder' }).click();
  await cel.waitForURL(BASE + '/operador/chat');
  const log = cel.getByRole('log', { name: 'Conversación con Administración' });
  await log.getByText('Hola Juan, ¿cómo vas?').waitFor();
  await cel.waitForFunction(() => !document.querySelector('[aria-label^="Chat:"]')?.getAttribute('aria-label')?.includes('sin leer'));
  ok('Al abrir el chat quedan leídos', psql(`select count(*) from mensajes where para_id='${JUAN}' and leido_at is null`) === '0');
  await cel.getByText('La app ya quedó guardada').waitFor({ timeout: 15000 }).then(() => cel.getByRole('button', { name: 'OK' }).click()).catch(() => undefined);
  await cel.getByLabel('Escribir mensaje').fill('Voy por la Ruta 1, termino hoy');
  await cel.getByRole('button', { name: 'Enviar mensaje' }).click();
  await log.getByText('Voy por la Ruta 1, termino hoy').waitFor();
  ok('El operador responde', psql(`select autor_id || '|' || para_id from mensajes where texto='Voy por la Ruta 1, termino hoy'`) === `${JUAN}|${JUAN}`);
  if (CAPT) await cel.screenshot({ path: CAPT + '/chat-operador.png' });
  await cel.goto(BASE + '/operador');
  const t = await cel.getByRole('region', { name: 'Mensajes del administrador' }).textContent();
  ok('Inicio: su propio mensaje no aparece como del administrador', !t.includes('termino hoy'), t);
});

await intentar('Chat: el admin ve la respuesta', async () => {
  await admin.goto(BASE + '/admin');
  await admin.getByRole('navigation').getByLabel('1 sin leer').waitFor();
  ok('Menú: Mensajes con 1 sin leer', true);
  await admin.goto(BASE + `/admin/mensajes?con=${JUAN}`);
  const log = admin.getByRole('log', { name: 'Conversación con Juan Pérez' });
  await log.getByText('Voy por la Ruta 1, termino hoy').waitFor();
  await admin.waitForFunction(() => !document.querySelector('nav[aria-label="Secciones"]').textContent.match(/Mensajes\d/));
  ok('Al abrirla queda leída', psql(`select leido_at is not null from mensajes where texto='Voy por la Ruta 1, termino hoy'`) === 't');
  ok('Lista: último mensaje del operador', (await admin.getByRole('button', { name: /^Conversación con Juan Pérez/ }).textContent()).includes('termino hoy'));
  if (CAPT) await admin.screenshot({ path: CAPT + '/chat-admin.png' });
});

await intentar('Chat: mensaje para todos', async () => {
  await admin.getByRole('button', { name: /Todos los operadores/ }).click();
  await admin.getByLabel('Escribir mensaje').fill('Mañana no se sale por lluvia');
  await admin.getByLabel('Escribir mensaje').press('Enter');
  await admin.getByRole('log', { name: 'Conversación con todos los operadores' }).getByText('Mañana no se sale por lluvia').waitFor();
  ok('Guarda el mensaje general', psql(`select count(*) from mensajes where para_id is null`) === '1');
  await cel.goto(BASE + '/operador/chat');
  const log = cel.getByRole('log', { name: 'Conversación con Administración' });
  await log.getByText('Mañana no se sale por lluvia').waitFor();
  ok('El operador lo ve marcado "Para todos"', (await log.textContent()).includes('Para todos'));
});

await intentar('Chat: un operador no puede escribirle a otro', async () => {
  const r = await cel.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('lecturas-auth'));
    const res = await fetch('http://supabase.test/rest/v1/mensajes', { method: 'POST', headers: { Authorization: `Bearer ${s.access_token}`, apikey: 'x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ autor_id: s.user.id, para_id: 'bbbbbbbb-0000-0000-0000-000000000003', texto: 'hola María' }) });
    return res.status;
  });
  ok('La base lo rechaza', r === 401 || r === 403, String(r));
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await admin.context().unrouteAll({ behavior: 'ignoreErrors' }); await cel.context().unrouteAll({ behavior: 'ignoreErrors' });
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
