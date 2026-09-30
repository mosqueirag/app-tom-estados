// Prueba de punta a punta del módulo administrador contra PostgREST + Postgres reales.
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
  // Edge Functions simuladas (la lógica real está en supabase/functions)
  if (url.pathname === '/functions/v1/crear-operador') {
    const b = req.postDataJSON();
    const email = b.email ?? `${b.usuario}@usuarios.lecturas.app`;
    if (psql(`select count(*) from auth.users where email='${email}'`) !== '0') return json(route, 409, { error: 'Ya existe un usuario con ese email o nombre de usuario.' });
    const id = crypto.randomUUID(); USERS[email] = id;
    psql(`insert into auth.users (id,email,raw_user_meta_data) values ('${id}','${email}','${JSON.stringify({ nombre: b.nombre, usuario: b.usuario ?? null })}'); update perfiles set activo=true where id='${id}'`);
    return json(route, 201, { id, mensaje: 'Operador creado.' });
  }
  if (url.pathname === '/functions/v1/gestionar-operador') {
    const b = req.postDataJSON();
    if (b.accion === 'resetear_password') return json(route, 200, { mensaje: 'Se cambió la contraseña.' });
    psql(`update perfiles set activo=${b.accion === 'activar'} where id='${b.operador_id}'`);
    return json(route, 200, { mensaje: b.accion === 'activar' ? 'Operador activado.' : 'Operador desactivado.' });
  }
  return json(route, 404, { message: 'sin mock ' + url.pathname });
}

async function rpcOperador(email, lecturas) {
  const r = await fetch(`${PGRST}/rpc/sincronizar_lecturas`, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(USERS[email], email), 'Content-Type': 'application/json' }, body: JSON.stringify({ p_lecturas: lecturas }) });
  return r.json();
}



const resultados = [];
const ok = (n, c, extra = '') => resultados.push(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);
const intentar = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message.split('\n')[0]); console.log('DBG', page.url(), (await page.locator('body').textContent()).slice(0, 300)); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true });
await ctx.route('http://supabase.test/**', mock);
const page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
const main = page.locator('main');
const estado = page.locator('header [role=status]');

await intentar('Manifest', async () => {
  await page.goto(BASE + '/login');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const m = await (await page.request.get(BASE + '/' + href.replace(/^\//, ''))).json();
  const iconos = await Promise.all(m.icons.map(async (i) => (await page.request.get(BASE + i.src)).status()));
  ok('Manifest: nombre, standalone, color, íconos 192/512', m.name === 'Lecturas de medidores' && m.display === 'standalone' && m.theme_color === '#0f766e'
    && m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && iconos.every((s) => s === 200), JSON.stringify(m.icons.map((i) => i.sizes + (i.purpose ? '/' + i.purpose : ''))));
  ok('Ícono para iPhone', (await page.request.get(BASE + '/icons/apple-touch-icon.png')).status() === 200 && await page.locator('link[rel=apple-touch-icon]').count() === 1);
});

await intentar('Service worker', async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByText('La app ya quedó guardada').waitFor({ timeout: 15000 });
  ok('Service worker instalado y aviso "abre sin señal"', true);
  const cacheadas = await page.evaluate(async () => { const ks = await caches.keys(); let n = 0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return n; });
  ok('App completa guardada en caché', cacheadas >= 20, `${cacheadas} archivos`);
});

await page.getByLabel('Email o usuario').fill('jperez'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');
await main.getByRole('button', { name: 'Descargar cuentas' }).click();
await main.getByText(/Listo: \d+ cuentas guardadas/).waitFor();

await intentar('Abrir sin señal', async () => {
  await ctx.setOffline(true);
  await page.reload();
  await estado.waitFor({ timeout: 15000 });
  ok('Recargar en modo avión: la app abre y sigue la sesión', page.url() === BASE + '/operador' && (await estado.textContent()).startsWith('Sin conexión'), await estado.textContent());
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase5-modo-avion.png` });
  const p2 = await ctx.newPage();
  await p2.goto(BASE + '/operador/buscar');
  await p2.getByLabel('Buscar cuenta').fill('10002');
  ok('Abrir una pantalla interna sin señal (enlace directo)', (await p2.locator('main li a').count()) === 1);
  await p2.close();

  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  await main.getByLabel('Buscar cuenta').fill('10002');
  await main.locator('li a', { hasText: '10002' }).click();
  await main.getByRole('textbox').first().fill('8770');
  await main.getByRole('button', { name: 'Continuar' }).click();
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10002 guardada.').waitFor();
  ok('Cargar lectura en modo avión', (await estado.textContent()) === 'Sin conexión · 1 lectura pendiente');

  await page.reload();
  await estado.waitFor();
  ok('La lectura pendiente sobrevive a cerrar/recargar la app', (await estado.textContent()) === 'Sin conexión · 1 lectura pendiente');
});

await intentar('Vuelve la señal', async () => {
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('header [role=status]')?.textContent === 'En línea · todo enviado', null, { timeout: 20000 });
  ok('Al volver la señal se envía', psql("select lectura_actual from lecturas where cuenta_id=(select id from cuentas where numero_cuenta='10002')") === '8770.000');
});

await intentar('Ayuda', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Ayuda' }).click();
  await main.getByRole('heading', { name: 'Instalar la app' }).waitFor();
  const t = await main.textContent();
  ok('Pantalla de ayuda para instalar (Android e iPhone)', t.includes('Instalar app') && t.includes('Agregar a inicio') && t.includes('solo con la app abierta'), t.slice(0, 200));
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase5-ayuda.png`, fullPage: true });
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.log(resultados.join('\n'));
await browser.close();
process.exit(resultados.some((r) => r.startsWith('✗')) ? 1 : 0);
