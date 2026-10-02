// Fase 13: modo oscuro y letra grande, aviso de batería baja, resumen del día y nota de voz.
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

const JUAN = USERS['jperez@usuarios.lecturas.app'];
psql(`update rutas set operador_id='${JUAN}' where nombre='Ruta 1';
      update cuentas set ruta='Ruta 1', operador_id='${JUAN}' where numero_cuenta between '10001' and '10005';
      update cuentas set ruta='Ruta 2', operador_id='${USERS['mgomez@usuarios.lecturas.app']}' where numero_cuenta between '10006' and '10010';
      insert into periodos (nombre) select 'Octubre 2026' where not exists (select 1 from periodos where activo);`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true, permissions: ['microphone'] });
// Batería simulada al 15% y sin cargar (en iPhone esta API no existe)
await ctx.addInitScript(() => {
  const b = new EventTarget(); b.level = 0.15; b.charging = false;
  navigator.getBattery = () => Promise.resolve(b);
  window.__bateria = b;
});
await ctx.route('http://supabase.test/**', mock);
let page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
let main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('jperez'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');
await main.getByRole('button', { name: 'Descargar cuentas' }).click();
await main.getByText(/Listo: \d+ cuentas guardadas/).waitFor();
const TOTAL = Number((await main.getByText(/Listo: \d+ cuentas/).textContent()).match(/(\d+) cuentas/)[1]);

await intentar('Modo oscuro y letra grande', async () => {
  await main.getByRole('switch', { name: 'Modo oscuro' }).check({ force: true });
  const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  ok('Modo oscuro: cambia el fondo', (await page.evaluate(() => document.documentElement.classList.contains('oscuro'))) && fondo.includes('rgb(11, 18, 32)'), fondo);
  await main.getByRole('switch', { name: 'Letra grande' }).check({ force: true });
  ok('Letra grande: agranda la base de la letra', (await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)) === '19px');
  if (CAPT) await page.screenshot({ path: CAPT + '/modo-oscuro.png', fullPage: true });
  await page.reload();
  await main.getByRole('switch', { name: 'Modo oscuro' }).waitFor({ state: 'attached' });
  ok('Pantalla: se recuerda al volver a abrir', await page.evaluate(() => document.documentElement.classList.contains('oscuro') && document.documentElement.classList.contains('letra-grande')));
  await main.getByRole('switch', { name: 'Letra grande' }).uncheck({ force: true });
});

async function cargar(numero, { valor, sinLectura, nota } = {}) {
  await page.goto(BASE + '/operador/buscar');
  await main.getByLabel('Buscar cuenta').fill(numero);
  await main.getByRole('link', { name: new RegExp(numero) }).first().click();
  await main.getByRole('button', { name: 'Continuar' }).waitFor();
  if (sinLectura) {
    await main.getByText('No se pudo leer').click();
    await main.getByLabel('Observación').fill(sinLectura);
  } else await main.getByRole('textbox').first().fill(valor);
  if (nota) {
    await main.getByRole('button', { name: 'Grabar nota de voz' }).click();
    await main.getByRole('timer').waitFor();
    await page.waitForTimeout(2200);
    await main.getByRole('button', { name: 'Terminar' }).click();
    await main.getByLabel('Nota de voz grabada').waitFor();
  }
  await main.getByRole('button', { name: 'Continuar' }).click();
  const chk = main.getByText(/Revisé/);
  if (await chk.count()) await chk.first().click();
  if (nota) ok('Nota de voz: aparece en la confirmación', (await main.textContent()).includes('Con nota de voz'));
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText(`Lectura de la cuenta ${numero} guardada.`).waitFor();
}

await intentar('Aviso de batería baja', async () => {
  // Sin conexión con el servidor: la lectura queda pendiente
  await page.route('**/rest/v1/rpc/sincronizar_lecturas', (r) => r.abort('internetdisconnected'));
  await cargar('10001', { valor: '99999' });
  const alerta = page.getByRole('alert').filter({ hasText: 'Batería baja' });
  await alerta.waitFor();
  ok('Batería: avisa con el porcentaje y las lecturas sin enviar', (await alerta.textContent()).includes('Batería baja (15%) y tenés 1 lectura sin enviar'), await alerta.textContent());
  if (CAPT) await page.screenshot({ path: CAPT + '/bateria-baja.png' });
  await page.evaluate(() => { window.__bateria.charging = true; window.__bateria.dispatchEvent(new Event('chargingchange')); });
  await alerta.waitFor({ state: 'detached' });
  ok('Batería: al enchufarlo el aviso se va', true);
  await page.evaluate(() => { window.__bateria.charging = false; window.__bateria.dispatchEvent(new Event('chargingchange')); });
  await alerta.waitFor();
  await page.unroute('**/rest/v1/rpc/sincronizar_lecturas');
  await alerta.getByRole('button', { name: 'Enviar' }).click();
  await alerta.waitFor({ state: 'detached' });
  ok('Batería: al enviar todo el aviso se va', psql(`select count(*) from lecturas where operador_id = '${JUAN}'`) === '1');
});

await intentar('Nota de voz', async () => {
  await cargar('10002', { sinLectura: 'Perro suelto', nota: true });
  await page.waitForFunction(() => document.querySelector('header [role=status]')?.textContent === 'En línea · todo enviado', null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const id = psql("select l.id from lecturas l join cuentas c on c.id = l.cuenta_id where c.numero_cuenta = '10002'");
  const audio = psql(`select audio_path from lecturas where id = '${id}'`);
  ok('Nota de voz: se sube a la carpeta del operador y queda en la lectura', audio === `${JUAN}/${id}.webm` && subidas.some((s) => s.path === `notas-voz/${JUAN}/${id}.webm` && s.cuerpo.length > 1000), `${audio} · ${subidas.map((s) => s.path + ':' + s.cuerpo.length).join(',')}`);
  ok('Nota de voz: se borra del celular después de subirla', await page.evaluate(async () => {
    const r = await new Promise((ok) => { const x = indexedDB.open('lecturas-medidores'); x.onsuccess = () => ok(x.result); });
    return new Promise((ok) => { const g = r.transaction('audios').objectStore('audios').count(); g.onsuccess = () => ok(g.result === 0); });
  }));
});

await intentar('Resumen del día', async () => {
  await cargar('10003', { sinLectura: 'Perro suelto' });
  await cargar('10004', { sinLectura: 'Casa cerrada' });
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).dispatchEvent('click');
  const resumen = main.getByRole('region', { name: 'Resumen del día' });
  await resumen.waitFor();
  const texto = await resumen.textContent();
  ok('Resumen: leídas, sin lectura y pendientes', texto.includes('1leídas') && texto.includes('3sin lectura') && texto.includes(`${TOTAL - 4}pendientes`), texto);
  ok('Resumen: motivos agrupados', texto.includes('Perro suelto2') && texto.includes('Casa cerrada1'), texto);
  if (CAPT) await page.screenshot({ path: CAPT + '/resumen-dia.png', fullPage: true });
});

await ctx.close();
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR' });
await ctx.route('http://supabase.test/**', mock);
page = await ctx.newPage(); main = page.locator('main');
page.on('pageerror', (e) => errores.push(e.message));
await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Admin escucha la nota de voz', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Lecturas' }).click();
  await main.getByRole('button', { name: 'Escuchar nota de voz de 10002' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Nota de voz').waitFor();
  const src = await d.getByLabel('Nota de voz').getAttribute('src');
  ok('Admin: reproduce la nota con un link firmado', src.includes('/storage/v1/object/sign/notas-voz/') && firmadas.some((f) => f.includes('notas-voz')), src);
  ok('Admin: la pantalla del admin no queda en modo oscuro', !(await page.evaluate(() => document.documentElement.classList.contains('oscuro'))));
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
