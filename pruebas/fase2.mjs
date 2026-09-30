import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
import fs from 'fs';

const CAPT = process.env.CAPTURAS;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USERS = {
  'admin@x.com': { id: 'aaaaaaaa-0000-0000-0000-000000000001', nombre: 'Guille Admin', rol: 'admin', activo: true },
  'jperez@usuarios.lecturas.app': { id: 'bbbbbbbb-0000-0000-0000-000000000002', nombre: 'Juan Pérez', rol: 'operador', activo: true, usuario: 'jperez' },
  'inactivo@x.com': { id: 'cccccccc-0000-0000-0000-000000000003', nombre: 'Pepe Inactivo', rol: 'operador', activo: false },
};
let sinRed = false;
const byId = (id) => Object.entries(USERS).find(([, u]) => u.id === id);
function sesion(email) {
  const u = USERS[email]; const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: u.id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, exp, role: 'authenticated', aud: 'authenticated', email })}.firma`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + u.id, user };
}
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(route) {
  if (sinRed) return route.abort('internetdisconnected');
  const req = route.request(); const url = new URL(req.url());
  if (url.pathname === '/auth/v1/token') {
    const body = req.postDataJSON();
    if (url.searchParams.get('grant_type') === 'password') {
      if (body.email === 'baneado@x.com') return json(route, 400, { code: 'user_banned', error_code: 'user_banned', msg: 'User is banned' });
      if (!USERS[body.email] || body.password !== 'secreto') return json(route, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(route, 200, sesion(body.email));
    }
    const e = byId(body.refresh_token.slice(2)); return json(route, 200, sesion(e[0]));
  }
  if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (url.pathname === '/auth/v1/user') { const sub = JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub; const e = byId(sub); return json(route, 200, sesion(e[0]).user); }
  if (url.pathname === '/rest/v1/perfiles') {
    const id = url.searchParams.get('id').replace('eq.', ''); const e = byId(id);
    const p = e ? [{ id, email: e[0], usuario: e[1].usuario ?? null, nombre: e[1].nombre, rol: e[1].rol, activo: e[1].activo, created_at: '2026-09-30' }] : [];
    const obj = (req.headers().accept || '').includes('vnd.pgrst.object');
    return json(route, 200, obj ? p[0] ?? null : p);
  }
  return json(route, 404, { message: 'no mock ' + url.pathname });
}

const resultados = [];
const ok = (nombre, cond, extra = '') => { resultados.push(`${cond ? '✓' : '✗'} ${nombre}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR' });
await ctx.route('http://supabase.test/**', mock);
const page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
const BASE = 'http://localhost:4173';
const login = async (u, p) => { await page.getByLabel('Email o usuario').fill(u); await page.getByLabel('Contraseña').fill(p); await page.getByRole('button', { name: 'Ingresar' }).click(); };

await page.goto(BASE + '/');
await page.waitForURL('**/login'); ok('Sin sesión, "/" va al login', true);
if (CAPT) await page.screenshot({ path: `${CAPT}/fase2-login.png` });
await login('jperez', 'mala');
await page.getByRole('alert').waitFor(); ok('Contraseña incorrecta', (await page.getByRole('alert').textContent()).includes('Usuario o contraseña incorrectos'));
await login('baneado@x.com', 'secreto');
await page.getByText('Tu usuario está desactivado').waitFor(); ok('Usuario bloqueado muestra aviso', true);

await login('jperez', 'secreto');
await page.waitForURL(BASE + '/operador'); ok('Operador con nombre de usuario entra a /operador', await page.getByRole('heading', { name: 'Juan Pérez' }).isVisible());
if (CAPT) await page.screenshot({ path: `${CAPT}/fase2-operador.png` });
await page.goto(BASE + '/admin/cuentas'); await page.waitForURL(BASE + '/operador'); ok('Operador no puede entrar a /admin', true);

// Sin señal con el token vencido: la sesión guardada debe seguir sirviendo
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('lecturas-auth')); s.expires_at = Math.floor(Date.now() / 1000) - 60; localStorage.setItem('lecturas-auth', JSON.stringify(s)); });
sinRed = true;
await page.reload(); const t0 = Date.now(); await page.getByText('trabajando con la sesión guardada').waitFor({ timeout: 15000 }); const demora = Date.now() - t0;
ok('Sin señal y token vencido: sigue en /operador con el perfil guardado', page.url() === BASE + '/operador', `entró en ${demora} ms`);
if (CAPT) await page.screenshot({ path: `${CAPT}/fase2-operador-sin-senal.png` });
await ctx.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click(); await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click();
ok('Modo avión: indicador "Sin conexión"', await page.getByRole('status').filter({ hasText: 'Sin conexión' }).isVisible());
await ctx.setOffline(false);
sinRed = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.getByText('trabajando con la sesión guardada').waitFor({ state: 'detached', timeout: 15000 });
ok('Al volver la señal se verifica la sesión', true);

await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await page.waitForURL('**/login');
ok('Cerrar sesión borra el perfil guardado', (await page.evaluate(() => localStorage.getItem('lecturas-perfil'))) === null);

// Sin señal y sin sesión previa → no entra
sinRed = true; await page.reload(); await page.waitForURL('**/login'); ok('Sin señal y sin sesión: queda en login', true); sinRed = false;

await page.setViewportSize({ width: 1280, height: 800 });
await login('admin@x.com', 'secreto');
await page.waitForURL(BASE + '/admin'); await page.getByRole('link', { name: 'Operadores' }).waitFor(); ok('Admin entra a /admin', true);
if (CAPT) await page.screenshot({ path: `${CAPT}/fase2-admin.png` });
await page.goto(BASE + '/operador/buscar'); await page.waitForURL(BASE + '/admin'); ok('Admin no entra a /operador', true);
await page.goto(BASE + '/admin/periodos'); await page.getByRole('heading', { name: 'Períodos' }).waitFor(); ok('Ruta de admin carga tras recargar', true);
await page.getByRole('button', { name: 'Cerrar sesión' }).click(); await page.waitForURL('**/login');

await page.setViewportSize({ width: 390, height: 844 });
await login('inactivo@x.com', 'secreto');
await page.getByRole('heading', { name: 'Usuario desactivado' }).waitFor(); ok('Perfil inactivo ve "Usuario desactivado"', true);
await page.goto(BASE + '/no-existe'); ok('404', await page.getByText('Página no encontrada').isVisible());

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.log(resultados.join('\n'));
await browser.close();
process.exit(resultados.some((r) => r.startsWith('✗')) ? 1 : 0);
