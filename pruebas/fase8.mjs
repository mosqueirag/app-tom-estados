// Fase 8: foto del medidor, GPS y mapa. Prueba de punta a punta del módulo administrador contra PostgREST + Postgres reales.
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
  if (url.pathname.startsWith('/storage/v1/object/sign/') && req.method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpegDe(subidas.at(-1)?.cuerpo) });
  }
  if (url.pathname.startsWith('/storage/v1/object/sign/')) {
    const path = url.pathname.replace('/storage/v1/object/sign/fotos-medidores/', '');
    return json(route, 200, { signedURL: `/object/sign/fotos-medidores/${path}?token=t` });
  }
  if (url.pathname.startsWith('/storage/v1/object/fotos-medidores/') && req.method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpegDe(subidas.at(-1)?.cuerpo) });
  }
  if (url.pathname.startsWith('/storage/v1/object/fotos-medidores/')) {
    subidas.push({ path: url.pathname.replace('/storage/v1/object/fotos-medidores/', ''), cuerpo: req.postDataBuffer(), auth: req.headers().authorization });
    return json(route, 200, { Key: url.pathname.slice('/storage/v1/object/'.length) });
  }
  return json(route, 404, { message: 'sin mock ' + url.pathname });
}

const subidas = [];
// supabase-js sube el archivo dentro de un multipart: se extrae el JPEG
function jpegDe(cuerpo) {
  if (!cuerpo) return Buffer.alloc(0);
  const i = cuerpo.indexOf(Buffer.from([0xff, 0xd8, 0xff])); const f = cuerpo.lastIndexOf(Buffer.from([0xff, 0xd9]));
  return i >= 0 && f > i ? cuerpo.subarray(i, f + 2) : cuerpo;
}
const resultados = [];
const ok = (n, c, extra = '') => resultados.push(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);
const intentar = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message.split('\n')[0]); console.log('DBG', page.url(), (await page.locator('main').textContent()).slice(0, 500)); } };
const FOTO = '/mnt/project-files/app-tom-estados/public/icons/lecturas-512.png';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true, timezoneId: 'America/Argentina/Buenos_Aires',
  permissions: ['geolocation'], geolocation: { latitude: -34.6037, longitude: -58.3816, accuracy: 12 } });
await ctx.route('http://supabase.test/**', mock);
let page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
let main = page.locator('main');
const estado = () => page.locator('header [role=status]').textContent();

async function abrir(numero) {
  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  await main.getByLabel('Buscar cuenta').fill(numero);
  await main.locator('a', { hasText: numero }).first().click();
}

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('jperez'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');
await main.getByRole('button', { name: 'Descargar cuentas' }).click();
await main.getByText(/Listo: \d+ cuentas guardadas/).waitFor();

await intentar('Foto y GPS', async () => {
  await abrir('10001');
  await main.getByText('Ubicación tomada (±12 m)').waitFor();
  ok('Toma la ubicación al abrir la cuenta', true);
  await main.getByLabel('Foto del medidor').setInputFiles(FOTO);
  await main.getByRole('button', { name: 'Continuar' }).waitFor();
  await main.getByText('Cambiar foto').waitFor();
  ok('Muestra la foto sacada', await main.getByRole('img', { name: 'Foto del medidor' }).isVisible());
  if (CAPT) await page.screenshot({ path: `${CAPT}/foto-cargar.png`, fullPage: true });
  await main.getByRole('textbox').first().fill('15262');
  await main.getByRole('button', { name: 'Continuar' }).click();
  await main.getByText('Con foto · Ubicación tomada (±12 m)').waitFor();
  ok('Confirmar muestra foto y ubicación', true);
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10001 guardada.').waitFor();
  await page.waitForFunction(() => document.querySelector('header [role=status]')?.textContent === 'En línea · todo enviado', null, { timeout: 15000 });
  const fila = psql("select round(latitud::numeric,4)||'|'||round(longitud::numeric,4)||'|'||precision_gps||'|'||foto_path from lecturas where cuenta_id=(select id from cuentas where numero_cuenta='10001')");
  const [lat, lng, prec, path] = fila.split('|');
  ok('Servidor guardó la ubicación', lat === '-34.6037' && lng === '-58.3816' && prec === '12', fila);
  ok('Subió la foto a la carpeta del operador', subidas.length === 1 && path === subidas[0].path && path.startsWith(USERS['jperez@usuarios.lecturas.app'] + '/'), JSON.stringify(subidas.map((s) => s.path)));
  const jpeg = jpegDe(subidas[0]?.cuerpo);
  ok('La foto se convierte a JPEG liviano', jpeg.length > 1000 && jpeg.length < 400000 && jpeg[0] === 0xff && jpeg[1] === 0xd8, `${jpeg.length} bytes`);
  ok('La cuenta guarda la ubicación para "Cómo llegar"', psql("select latitud is not null from cuentas where numero_cuenta='10001'") === 't');
  ok('Borra la foto del celular una vez subida', await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('lecturas-medidores'); q.onsuccess = () => { const c = q.result.transaction('fotos').objectStore('fotos').count(); c.onsuccess = () => r(c.result); }; })) === 0);
});

await intentar('Sin señal: la foto espera', async () => {
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await abrir('10002');
  await main.getByLabel('Foto del medidor').setInputFiles(FOTO);
  await main.getByText('Cambiar foto').waitFor();
  await main.getByRole('textbox').first().fill('8800');
  await main.getByRole('button', { name: 'Continuar' }).click();
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10002 guardada.').waitFor();
  ok('Sin señal la lectura con foto queda pendiente', (await estado()) === 'Sin conexión · 1 lectura pendiente', await estado());
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('header [role=status]')?.textContent === 'En línea · todo enviado', null, { timeout: 15000 });
  ok('Al volver la señal sube lectura y foto', subidas.length === 2 && psql("select foto_path is not null from lecturas where cuenta_id=(select id from cuentas where numero_cuenta='10002')") === 't');
});

await intentar('Foto obligatoria', async () => {
  psql('update configuracion set foto_obligatoria=true');
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click();
  await main.getByRole('button', { name: /Descargar cuentas|Actualizar cuentas|Volver a descargar/ }).first().click();
  await page.waitForTimeout(1500);
  await abrir('10005');
  await main.getByText('Foto del medidor (obligatoria)').waitFor();
  await main.getByRole('textbox').first().fill('1');
  await main.getByRole('button', { name: 'Continuar' }).click();
  await main.getByText('Sacá una foto del medidor para continuar.').waitFor();
  ok('Con foto obligatoria no deja seguir sin foto', true);
  psql('update configuracion set foto_obligatoria=false');
});

// ---------- Admin
await ctx.close();
ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
await ctx.route('http://supabase.test/**', mock);
await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 204 }));
page = await ctx.newPage(); main = page.locator('main');
page.on('pageerror', (e) => errores.push(e.message));
await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Admin: foto y mapa', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Lecturas' }).click();
  const fila = main.locator('tbody tr', { hasText: '10001' });
  await fila.waitFor();
  ok('Lecturas: link a Google Maps con la ubicación', (await fila.getByRole('link', { name: 'Mapa' }).getAttribute('href')).includes('-34.6037,-58.3816'));
  await fila.getByRole('button', { name: 'Foto' }).click();
  const img = page.getByRole('dialog').getByRole('img');
  await img.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector('dialog[open] img'); return i && i.complete && i.naturalWidth > 0; });
  ok('Lecturas: abre la foto del medidor', true);
  if (CAPT) await page.screenshot({ path: `${CAPT}/foto-admin.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();

  await page.getByRole('navigation').getByRole('link', { name: 'Mapa' }).click();
  await main.getByText('2 lecturas con ubicación').waitFor();
  ok('Mapa: un punto por lectura con ubicación', (await main.locator('path.leaflet-interactive').count()) === 2);
  await main.locator('path.leaflet-interactive').first().click({ force: true });
  await main.getByRole('button', { name: 'Ver foto' }).waitFor();
  ok('Mapa: al tocar un punto muestra la lectura', (await main.textContent()).includes('Juan Pérez'));
  if (CAPT) await page.screenshot({ path: `${CAPT}/mapa.png` });
  await page.getByRole('navigation').getByRole('link', { name: 'Panel' }).click();
  await main.getByText('Exigir foto en cada lectura').click();
  await main.getByText('Guardado. Los celulares lo toman').waitFor();
  ok('Panel: se puede exigir la foto', psql('select foto_obligatoria from configuracion') === 't');
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
