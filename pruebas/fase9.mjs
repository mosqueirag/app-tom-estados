// Fase 9: orden de recorrido por ruta y "Cómo llegar".
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
  // asignar-cuentas simulada: hace el mismo UPDATE que la función real (sin push)
  if (url.pathname === '/functions/v1/asignar-cuentas') {
    const b = req.postDataJSON(); llamadas.push(b);
    if (b.avisar) return json(route, 200, { avisos_enviados: 0, mensaje: `Aviso ${b.avisar} de ${b.cuenta_ids.length}.` });
    if (b.rutas) b.ruta = b.rutas.join("','");
    const op = b.operador_id ? `'${b.operador_id}'` : 'null';
    if (b.ruta) psql(`update rutas set operador_id=${op} where nombre in ('${b.ruta}')`);
    const donde = b.ruta !== undefined ? `ruta in ('${b.ruta}') and activa` : `id in (${b.cuenta_ids.map((i) => `'${i}'`).join(',')})`;
    const n = psql(`with u as (update cuentas set operador_id=${op} where ${donde} returning 1) select count(*) from u`);
    return json(route, 200, { actualizadas: Number(n), mensaje: `Se asignaron ${n} cuentas.` });
  }
  return json(route, 404, { message: 'sin mock ' + url.pathname });
}
const llamadas = [];
const resultados = [];
const ok = (n, c, extra = '') => resultados.push(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);
const intentar = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message.split('\n')[0]); console.log('DBG', page.url(), (await page.locator('main').textContent()).slice(0, 400)); } };


const JUAN = USERS['jperez@usuarios.lecturas.app'];
psql(`update rutas set operador_id='${JUAN}' where nombre='Ruta 1';
      update cuentas set ruta='Ruta 1', operador_id='${JUAN}' where numero_cuenta between '10001' and '10005';
      update cuentas set ruta='Ruta 2', operador_id='${JUAN}' where numero_cuenta between '10006' and '10008';
      update cuentas set latitud=-34.5, longitud=-58.5 where numero_cuenta='10004';`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR' });
await ctx.route('http://supabase.test/**', mock);
let page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
let main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Admin ordena la ruta', async () => {
  await main.getByRole('group', { name: 'Accesos rápidos' }).waitFor();
  ok('Panel: ya no tiene la sección de localidad ni los ajustes', (await main.getByRole('heading', { name: 'Localidad' }).count()) === 0 && (await main.getByText('Alerta de consumo anómalo').count()) === 0);
  // Una sola ciudad: la localidad queda cargada en la base (la usa "Cómo llegar")
  psql("update configuracion set localidad = 'San Rafael, Mendoza'");

  await page.getByRole('navigation').getByRole('link', { name: 'Rutas' }).click();
  await main.getByRole('row', { name: /^Ruta 1 / }).waitFor();
  await main.getByRole('button', { name: 'Ordenar recorrido de Ruta 1' }).click();
  const d = page.getByRole('dialog');
  await d.getByText('10005').waitFor();
  // 10005 al principio: se sube cuatro veces
  for (let i = 0; i < 4; i++) await d.getByRole('button', { name: 'Subir 10005' }).click();
  await d.getByRole('button', { name: 'Bajar 10001' }).click();
  if (CAPT) await page.screenshot({ path: CAPT + '/ordenar-recorrido.png' });
  await d.getByRole('button', { name: 'Guardar orden' }).click();
  await main.getByText('Se guardó el recorrido de Ruta 1.').waitFor();
  const orden = psql("select string_agg(numero_cuenta, ',' order by orden) from cuentas where ruta='Ruta 1'");
  ok('Rutas: guarda el orden del recorrido', orden === '10005,10002,10001,10003,10004', orden);
});

await ctx.close();
ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true });
await ctx.route('http://supabase.test/**', mock);
page = await ctx.newPage(); main = page.locator('main');
page.on('pageerror', (e) => errores.push(e.message));
await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('jperez'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');
await main.getByRole('button', { name: 'Descargar cuentas' }).click();
await main.getByText(/Listo: \d+ cuentas guardadas/).waitFor();

await intentar('Operador sigue el recorrido', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Recorrido' }).dispatchEvent('click');
  await main.getByLabel('Ruta').selectOption({ label: 'Ruta 1 (5)' });
  const sig = main.locator('section', { hasText: 'Siguiente' });
  await sig.waitFor();
  ok('Recorrido: la siguiente es la primera del orden', (await sig.textContent()).includes('10005'), await sig.textContent());
  const items = await main.locator('ol li').allTextContents();
  ok('Recorrido: lista en el orden del admin', items.map((t) => t.match(/100\d\d/)?.[0]).join(',') === '10005,10002,10001,10003,10004', items.join(' | '));
  const href = await sig.getByRole('link', { name: 'Cómo llegar' }).getAttribute('href');
  ok('Cómo llegar: dirección con la localidad', href.startsWith('https://www.google.com/maps/search/?api=1&query=') && decodeURIComponent(href).includes('San Rafael, Mendoza'), href);
  const hrefGps = await main.getByRole('link', { name: /Cómo llegar a/ }).nth(4).getAttribute('href');
  ok('Cómo llegar: usa el GPS si la cuenta lo tiene', hrefGps.endsWith('query=-34.5,-58.5'), hrefGps);
  if (CAPT) await page.screenshot({ path: CAPT + '/recorrido.png', fullPage: true });

  await sig.getByRole('link', { name: 'Cargar lectura' }).click();
  await main.getByRole('textbox').first().fill('99999');
  await main.getByRole('button', { name: 'Continuar' }).click();
  const chk = main.getByText('Revisé el medidor y el número es correcto');
  if (await chk.count()) await chk.first().click();
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10005 guardada.').waitFor();
  await page.getByRole('navigation').getByRole('link', { name: 'Recorrido' }).dispatchEvent('click');
  await main.locator('section', { hasText: 'Siguiente' }).waitFor();
  ok('Recorrido: después de leer, pasa a la siguiente', (await main.locator('section', { hasText: 'Siguiente' }).textContent()).includes('10002'));
  ok('Recorrido: recuerda la ruta elegida', (await main.getByLabel('Ruta').inputValue()) === 'Ruta 1');
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
