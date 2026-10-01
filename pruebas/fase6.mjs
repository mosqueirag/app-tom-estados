// Prueba de rutas y asignación de cuentas a operadores contra PostgREST + Postgres reales.
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

const JUAN = USERS['jperez@usuarios.lecturas.app'], MARIA = USERS['mgomez@usuarios.lecturas.app'];
psql("update cuentas set ruta='Ruta 1' where numero_cuenta between '10001' and '10005'; update cuentas set ruta='Ruta 2' where numero_cuenta between '10006' and '10010'");

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR' });
await ctx.route('http://supabase.test/**', mock);
let page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
let main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Rutas: lista y asignación de una ruta', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Rutas' }).click();
  await main.getByRole('heading', { name: 'Rutas' }).waitFor();
  await main.getByLabel('Operador de Ruta 20', { exact: true }).waitFor();
  ok('Rutas: una fila por ruta (las 20)', (await main.locator('tbody tr').count()) === 20);
  await main.getByLabel('Operador de Ruta 1', { exact: true }).selectOption({ label: 'Juan Pérez' });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await main.getByText('Se asignaron 5 cuentas.').waitFor();
  ok('Rutas: asignar Ruta 1 a Juan llama a la función con la ruta', llamadas.at(-1)?.ruta === 'Ruta 1' && llamadas.at(-1)?.operador_id === JUAN);
  ok('Rutas: la base quedó con 5 cuentas de Juan', psql(`select count(*) from cuentas where operador_id='${JUAN}'`) === '5');
  await page.waitForFunction(() => document.querySelector('select[aria-label="Operador de Ruta 1"]')?.selectedOptions[0]?.textContent === 'Juan Pérez');
  ok('Rutas: el selector muestra el operador asignado', true);
  if (CAPT) await page.screenshot({ path: `${CAPT}/rutas.png` });
});

await intentar('Cuentas: ruta, operador y filtro', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Cuentas' }).click();
  await main.locator('tr', { hasText: '10001' }).waitFor();
  ok('Cuentas: columna ruta y operador', (await main.locator('tr', { hasText: '10001' }).textContent()).includes('Ruta 1') && (await main.locator('tr', { hasText: '10001' }).textContent()).includes('Juan Pérez'));
  await main.getByLabel('Filtrar por ruta').selectOption('Ruta 2');
  await page.waitForFunction(() => document.querySelectorAll('main tbody tr').length === 5 && !document.querySelector('main tbody')?.textContent?.includes('10001'));
  ok('Cuentas: filtro por ruta', true);
  await main.locator('tr', { hasText: '10006' }).getByRole('button', { name: 'Editar' }).click();
  const d = page.locator('dialog[open]');
  await d.getByLabel('Operador').selectOption({ label: 'María Gómez' });
  await d.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText('Cuenta 10006 actualizada.').waitFor();
  ok('Cuentas: asignar una cuenta a María desde Editar', llamadas.at(-1)?.cuenta_ids?.length === 1 && psql("select operador_id from cuentas where numero_cuenta='10006'") === MARIA);
  if (CAPT) await page.screenshot({ path: `${CAPT}/cuentas-rutas.png` });
  await main.getByLabel('Filtrar por ruta').selectOption({ label: 'Todas las rutas' });
});

await intentar('Importar Excel con columna ruta', async () => {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
    ['numero_cuenta', 'titular', 'direccion', 'medidor', 'ultima_lectura', 'ruta'],
    ['10020', 'Paz, Andrea', 'Colón 200', 'MED-9', 100, 'Ruta 3'],
    ['10002', 'Fernández, Juan Carlos', 'Belgrano 845', 'MED-458722', 8741, 'Ruta 2'],
  ]), 'Hoja1');
  const archivo = `${TMP}/rutas.xlsx`; XLSX.writeFile(libro, archivo);
  await page.getByRole('button', { name: 'Importar Excel' }).click();
  const d = page.locator('dialog[open]');
  await d.locator('input[type=file]').setInputFiles(archivo);
  await d.getByRole('button', { name: /^Importar \d+ cuenta/ }).waitFor();
  const texto = await d.textContent();
  ok('Importar: detecta el cambio de ruta', texto.includes('Cambia: ruta'));
  await d.getByRole('button', { name: 'Importar 2 cuentas' }).click();
  await d.getByText(/Listo: 1 cuentas nuevas y 1 actualizadas/).waitFor();
  ok('Importar: guarda la ruta', psql("select string_agg(numero_cuenta||'='||ruta, ' ' order by numero_cuenta) from cuentas where numero_cuenta in ('10002','10020')") === '10002=Ruta 2 10020=Ruta 3');
  await page.keyboard.press('Escape');
});
await ctx.close();

// ---------------------------------------------------------------- operadores
ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true });
await ctx.route('http://supabase.test/**', mock);
page = await ctx.newPage(); page.on('pageerror', (e) => errores.push(e.message)); page.on('dialog', (d) => d.accept());
main = page.locator('main');

async function entrarYDescargar(usuario) {
  await page.goto(BASE + '/login');
  await page.getByLabel('Email o usuario').fill(usuario); await page.getByLabel('Contraseña').fill('secreto');
  await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');
  await main.getByRole('button', { name: 'Descargar cuentas' }).click();
  return (await main.getByText(/^Listo: \d+ cuentas/).textContent()).match(/\d+/)[0];
}

await intentar('Operadores: cada uno descarga lo suyo', async () => {
  // Juan: Ruta 1 (4) + Ruta 2 sin asignar (5, con la 10002 que cambió de ruta; la 10006 es de María) + 10020 = 10
  ok('Juan descarga sus cuentas y las sin asignar (10)', (await entrarYDescargar('jperez')) === '10');
  ok('Aparece la tarjeta para activar avisos', await main.getByRole('button', { name: 'Activar avisos' }).isVisible());
  if (CAPT) await page.screenshot({ path: `${CAPT}/operador-avisos.png` });
  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  await main.getByLabel('Buscar cuenta').fill('Paz Andrea');
  await page.waitForFunction(() => document.querySelectorAll('main li').length === 1);
  ok('Buscar: la ruta se ve y se puede buscar', (await main.locator('li').first().textContent()).includes('Ruta 3'));
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click();
  await main.getByRole('button', { name: 'Cerrar sesión' }).dispatchEvent('click'); await page.waitForURL('**/login');
  // María: 10006 + Ruta 2 sin asignar (5: la 10002 pasó a Ruta 2 al importar y tomó el operador de esa ruta, ninguno) + 10020 = 7
  ok('María descarga las suyas (7)', (await entrarYDescargar('mgomez')) === '7');
});

await intentar('Al tocar el aviso se descargan solas', async () => {
  // A María le asignan la Ruta 1 (10001, 10003-10005): 7 + 4 = 11
  psql(`update cuentas set operador_id='${MARIA}' where ruta='Ruta 1'`);
  await page.goto(BASE + '/operador?descargar=1');
  await main.getByText('Listo: 11 cuentas').waitFor();
  ok('Abre con ?descargar=1 y descarga sola (María ahora tiene 11)', !page.url().includes('descargar'));
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.log(resultados.join('\n'));
await browser.close();
process.exit(resultados.some((r) => r.startsWith('✗')) ? 1 : 0);
