// Fase 12: tablero de avance, mensajes a operadores, historial de cambios y comparación de períodos.
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
    return json(route, 400, { error: 'modo no simulado' });
  }
  return json(route, 404, { message: 'sin mock ' + url.pathname });
}
const llamadas = [];
const resultados = [];
const ok = (n, c, extra = '') => resultados.push(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);
const intentar = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message.split('\n')[0]); console.log('DBG', n, page.url(), (await page.locator('main').textContent({ timeout: 2000 }).catch(() => '')).slice(0, 400)); } };

const JUAN = USERS['jperez@usuarios.lecturas.app'], MARIA = USERS['mgomez@usuarios.lecturas.app'];
psql(`update rutas set operador_id='${JUAN}' where nombre='Ruta 1';
      update cuentas set ruta='Ruta 1', operador_id='${JUAN}' where numero_cuenta between '10001' and '10005';
      update cuentas set ruta='Ruta 2', operador_id='${MARIA}' where numero_cuenta between '10006' and '10008';
      insert into periodos (nombre) select 'Octubre 2026' where not exists (select 1 from periodos where activo);
      insert into periodos (nombre, fecha_inicio, fecha_cierre, activo) values ('Septiembre 2026', '2026-08-01', '2026-08-31', false);`);
const ACTIVO = psql('select id from periodos where activo');
const ANTES = psql("select id from periodos where nombre = 'Septiembre 2026'");
const lectura = (periodo, cuenta, op, consumo, cuando) =>
  `insert into lecturas (id, periodo_id, cuenta_id, operador_id, lectura_anterior, lectura_actual, fecha_lectura)
   select gen_random_uuid(), '${periodo}', id, '${op}', 100, ${100 + consumo}, ${cuando} from cuentas where numero_cuenta = '${cuenta}';`;
psql(`set session_replication_role = replica;
  ${lectura(ANTES, '10001', JUAN, 10, "'2026-08-10'")} ${lectura(ANTES, '10002', JUAN, 10, "'2026-08-10'")}
  ${lectura(ANTES, '10003', JUAN, 10, "'2026-08-10'")} ${lectura(ANTES, '10006', MARIA, 20, "'2026-08-10'")}
  ${lectura(ACTIVO, '10001', JUAN, 20, "now() - interval '60 minutes'")} ${lectura(ACTIVO, '10002', JUAN, 20, "now() - interval '10 minutes'")}
  ${lectura(ACTIVO, '10006', MARIA, 20, "now() - interval '1 day'")}`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
await ctx.route('http://supabase.test/**', mock);
let page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
let main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Tablero de avance', async () => {
  const tabla = main.getByRole('table', { name: 'Avance por operador' });
  await tabla.waitFor();
  const juan = (await tabla.locator('tr', { hasText: 'Juan Pérez' }).locator('td').allTextContents()).map((t) => t.trim());
  ok('Tablero: lecturas de hoy, ritmo y pendientes de Juan', juan[1] === '2' && /\(hace 10 min\)/.test(juan[2]) && juan[3] === '2,4' && juan[4] === '3', juan.join(' | '));
  const maria = (await tabla.locator('tr', { hasText: 'María Gómez' }).locator('td').allTextContents()).map((t) => t.trim());
  ok('Tablero: María sin lecturas hoy (la de ayer no cuenta)', maria[1] === '0' && maria[2] === 'Sin lecturas hoy' && maria[4] === '2', maria.join(' | '));
  if (CAPT) await page.screenshot({ path: CAPT + '/tablero-avance.png', fullPage: true });
});

await intentar('Mensaje a un operador desde el tablero', async () => {
  await main.getByRole('button', { name: 'Mensaje a Juan Pérez' }).click();
  const d = page.getByRole('dialog');
  ok('Mensaje: viene elegido el operador', (await d.getByRole('combobox').inputValue()) === JUAN);
  await d.getByRole('button', { name: 'Priorizar la Ruta' }).click();
  await d.getByRole('textbox').pressSequentially('2');
  await d.getByRole('button', { name: 'Enviar' }).click();
  await main.getByText('Mensaje enviado.').waitFor();
  ok('Mensaje: queda guardado para Juan', psql(`select texto || '|' || para_id || '|' || autor_id from mensajes`) === `Priorizar la Ruta 2|${JUAN}|${USERS['admin@x.com']}`);
});

await intentar('Mensaje a todos desde Operadores', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Operadores' }).click();
  await main.getByRole('button', { name: 'Mandar mensaje' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox').fill('Mañana no se sale por lluvia');
  await d.getByRole('button', { name: 'Enviar' }).click();
  await main.getByText('Últimos mensajes enviados').waitFor();
  await main.locator('li', { hasText: 'Mañana no se sale por lluvia' }).getByText(/para todos/).waitFor();
  const lista = (await main.locator('li', { hasText: /para (todos|Juan)/ }).allTextContents()).join(' | ');
  ok('Operadores: lista los mensajes enviados con destinatario', lista.includes('para todos') && lista.includes('para Juan Pérez'), lista.slice(0, 200));
});

await intentar('Historial de cambios', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Cuentas' }).click();
  await main.locator('tbody tr', { hasText: '10008' }).waitFor();
  await main.locator('tbody tr', { hasText: '10008' }).getByRole('button', { name: 'Dar de baja' }).click();
  await main.getByText('Cuenta 10008 dada de baja.').waitFor();

  await page.getByRole('navigation').getByRole('link', { name: 'Historial' }).click();
  await main.getByRole('heading', { name: 'Historial de cambios' }).waitFor();
  await main.locator('tbody tr').first().waitFor();
  const primera = await main.locator('tbody tr').first().textContent();
  ok('Historial: la baja arriba, con quién la hizo', primera.includes('Guille Admin') && primera.includes('Baja') && primera.includes('10008') && primera.includes('Activa: Sí → No'), primera);
  await main.getByLabel('Buscar en el historial').fill('10002');
  await page.waitForFunction(() => [...document.querySelectorAll('main tbody tr')].every((f) => f.textContent.includes('10002')));
  const filas = await main.locator('tbody tr').allTextContents();
  ok('Historial: busca por cuenta y muestra el nombre del operador', filas.length === 2 && filas[1].includes('Alta') && filas[0].includes('Operador: (vacío) → Juan Pérez') && filas[0].includes('Sistema'), filas.join(' | '));
  await main.getByLabel('Buscar en el historial').fill('');
  await main.getByLabel('Acción').selectOption('baja');
  await page.waitForFunction(() => document.querySelectorAll('main tbody tr').length === 1);
  ok('Historial: filtra por acción', true);
  if (CAPT) await page.screenshot({ path: CAPT + '/historial.png' });
});

await intentar('Comparación entre períodos', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Períodos' }).click();
  const tabla = main.getByRole('table', { name: 'Comparación por ruta' });
  await tabla.locator('tbody tr').first().waitFor();
  const celdas = async (texto) => (await tabla.locator('tr', { hasText: texto }).first().locator('td').allTextContents()).map((t) => t.trim());
  const r1 = await celdas('Ruta 1');
  ok('Comparación: Ruta 1 subió 33,3%', r1[1] === '30' && r1[2] === '40' && r1[3] === '+10' && r1[4] === '+33,3%', r1.join(' | '));
  const r2 = await celdas('Ruta 2');
  ok('Comparación: Ruta 2 igual', r2[1] === '20' && r2[2] === '20' && r2[4] === '0%', r2.join(' | '));
  const tot = (await tabla.locator('tfoot td').allTextContents()).map((t) => t.trim());
  ok('Comparación: total', tot[1] === '50' && tot[2] === '60' && tot[4] === '+20%', tot.join(' | '));
  if (CAPT) await page.screenshot({ path: CAPT + '/comparacion.png', fullPage: true });
});

await ctx.close();
ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true });
await ctx.route('http://supabase.test/**', mock);
page = await ctx.newPage(); main = page.locator('main');
page.on('pageerror', (e) => errores.push(e.message));
await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('jperez'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');

await intentar('Operador ve los mensajes', async () => {
  const caja = main.getByRole('region', { name: 'Mensajes del administrador' });
  await caja.getByText('Mensajes nuevos del administrador').waitFor();
  const texto = await caja.textContent();
  ok('Inicio: muestra los dos mensajes nuevos', texto.includes('Priorizar la Ruta 2') && texto.includes('para vos') && texto.includes('Mañana no se sale por lluvia') && texto.includes('para todos'), texto);
  if (CAPT) await page.screenshot({ path: CAPT + '/mensajes-operador.png' });
  await caja.getByRole('button', { name: 'Entendido' }).click();
  await caja.getByText('Último mensaje del administrador').waitFor();
  ok('Inicio: después de Entendido queda solo el último', (await caja.locator('li').count()) === 1);
  // Sin señal: el pedido de mensajes falla y se muestran los guardados en el celular
  await page.route('**/rest/v1/mensajes*', (r) => r.abort('internetdisconnected'));
  await page.reload();
  await main.getByRole('region', { name: 'Mensajes del administrador' }).getByText('Mañana no se sale por lluvia').waitFor();
  ok('Inicio: los mensajes se ven sin señal', true);
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
