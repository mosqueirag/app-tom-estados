// Fase 16: logo COOPSAR, filtros y orden en Lecturas, detalle de avisos, búsqueda sin localidad y contador de pendientes.
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
      update configuracion set localidad='';
      update cuentas set ruta='Ruta 1' where numero_cuenta in ('10001','10002','10003');
      update cuentas set ruta='Ruta 2' where numero_cuenta in ('10004','10005');`);
const ACTIVO = psql('select id from periodos where activo');
const lectura = (cuenta, op, consumo, cuando) =>
  `insert into lecturas (id, periodo_id, cuenta_id, operador_id, lectura_anterior, lectura_actual, fecha_lectura)
   select gen_random_uuid(), '${ACTIVO}', id, '${op}', 100, ${100 + consumo}, '${cuando}' from cuentas where numero_cuenta = '${cuenta}';`;
psql(`set session_replication_role = replica;
  ${lectura('10001', JUAN, 50, '2026-09-10 12:00-03')} ${lectura('10002', JUAN, 5, '2026-09-20 12:00-03')}
  ${lectura('10004', JUAN, 300, '2026-09-25 12:00-03')}`);
const ID_10004 = psql(`select l.id from lecturas l join cuentas c on c.id=l.cuenta_id where c.numero_cuenta='10004'`);

const consultasMapa = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
await ctx.route('http://supabase.test/**', mock);
await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 204 }));
await ctx.route('https://nominatim.openstreetmap.org/**', (r) => { consultasMapa.push(new URL(r.request().url())); return json(r, 200, []); });
let page = await ctx.newPage();
let main = page.locator('main');
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
const primeras = async () => (await main.locator('tbody tr td:first-child').allTextContents()).join(',');
const esperarFilas = async (texto) => page.waitForFunction((t) => [...document.querySelectorAll('main tbody tr td:first-child')].map((x) => x.textContent).join(',') === t, texto, { timeout: 10000 });

await intentar('Login con logo institucional', async () => {
  await page.goto(BASE + '/login');
  ok('Login: muestra el logo de COOPSAR', (await page.locator('header img[src="/logo/coopsar.svg"]').count()) === 1);
  ok('Login: ícono de la app nuevo', (await page.request.get(BASE + '/icons/medidor-192.png')).status() === 200);
  await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
  await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');
  ok('Panel: sin sección de localidad', (await main.getByRole('heading', { name: 'Localidad' }).count()) === 0);
  await page.getByRole('group', { name: 'Accesos rápidos' }).getByRole('link').first().waitFor();
  ok('Panel: accesos con íconos dibujados', (await page.getByRole('group', { name: 'Accesos rápidos' }).locator('svg').count()) >= 5);
});

await intentar('Lecturas: orden como en Excel', async () => {
  await page.goto(BASE + '/admin/lecturas');
  await esperarFilas('10004,10002,10001');
  ok('Por defecto: más nuevas primero', true);
  await main.getByRole('button', { name: 'Consumo' }).click();
  await esperarFilas('10002,10001,10004');
  ok('Consumo: de menor a mayor', (await main.locator('th[aria-sort="ascending"]').textContent()).includes('Consumo'));
  await main.getByRole('button', { name: 'Consumo' }).click();
  await esperarFilas('10004,10001,10002');
  ok('Consumo: de mayor a menor', page.url().includes('orden=consumo') && page.url().includes('dir=desc'));
  await main.getByRole('button', { name: 'Titular' }).click();
  await esperarFilas('10002,10001,10004');
  const titulares = await main.locator('tbody tr td:nth-child(2)').allTextContents();
  ok('Titular: de la A a la Z', JSON.stringify(titulares) === JSON.stringify([...titulares].sort((a, b) => a.localeCompare(b, 'es'))), titulares.join(' | '));
  await main.getByLabel('Ordenar por').selectOption('numero_cuenta');
  await esperarFilas('10001,10002,10004');
  await main.getByRole('button', { name: /Orden ascendente/ }).click();
  await esperarFilas('10004,10002,10001');
  ok('Selector de orden y botón para invertir', true);
});

await intentar('Lecturas: filtros por fecha, ruta y consumo', async () => {
  await main.getByLabel('Fecha desde').fill('2026-09-15');
  await esperarFilas('10004,10002');
  ok('Desde: deja afuera las anteriores', true);
  await main.getByLabel('Fecha hasta').fill('2026-09-20');
  await esperarFilas('10002');
  ok('Hasta: incluye el día completo', true);
  await main.getByRole('button', { name: 'Limpiar filtros' }).click();
  await esperarFilas('10004,10002,10001');
  ok('Limpiar filtros mantiene el orden elegido', page.url().includes('orden=numero_cuenta'));
  await main.getByLabel('Ruta').selectOption('Ruta 2');
  await esperarFilas('10004');
  ok('Filtro por ruta', true);
  await main.getByLabel('Ruta').selectOption('');
  await main.getByLabel('Consumo mínimo').fill('40');
  await esperarFilas('10004,10001');
  await main.getByLabel('Consumo máximo').fill('100');
  await esperarFilas('10001');
  ok('Filtro por consumo mínimo y máximo', true);
  const [descarga] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: 'Exportar a Excel' }).click()]);
  const libro = XLSX.readFile(await descarga.path());
  ok('Exportar respeta los filtros', XLSX.utils.sheet_to_json(libro.Sheets.Lecturas).length === 1);
  if (CAPT) await page.screenshot({ path: CAPT + '/lecturas-filtros.png', fullPage: true });
});

await intentar('Campana: detalle de un aviso', async () => {
  await page.evaluate((id) => localStorage.setItem('avisos-lecturas', JSON.stringify([{ id, tipo: 'lectura', numero_cuenta: '10004', titular: 'X',
    operador_nombre: 'Juan Pérez', lectura_actual: 400, consumo: 300, sin_lectura: false, observacion: null, alerta_menor_anterior: false,
    alerta_consumo_anomalo: true, fecha_lectura: '2026-09-25T15:00:00Z', recibida_at: '2026-09-25T15:01:00Z', leida: false }])), ID_10004);
  await page.goto(BASE + '/admin');
  await page.getByRole('button', { name: /^Avisos/ }).first().waitFor();
  await page.getByRole('button', { name: 'Avisos: 1 sin leer' }).click();
  await page.getByRole('button', { name: 'Ver detalle de la cuenta 10004' }).click();
  const d = page.getByRole('dialog', { name: 'Cuenta 10004' });
  await d.getByText('Medidor', { exact: false }).first().waitFor();
  const texto = await d.textContent();
  ok('Detalle: muestra anterior, actual, consumo y operador', texto.includes('Anterior') && texto.includes('400') && texto.includes('300') && texto.includes('Juan Pérez'), texto.slice(0, 200));
  ok('Detalle: trae los datos de la cuenta del servidor', texto.includes(psql(`select titular from cuentas where numero_cuenta='10004'`)));
  if (CAPT) await page.screenshot({ path: CAPT + '/detalle-aviso.png' });
  await d.getByRole('link', { name: 'Abrir en Lecturas' }).click();
  await page.waitForURL(/\/admin\/lecturas\?q=10004/);
  await esperarFilas('10004');
  ok('Detalle: lleva a la lectura en la tabla', true);
});

await intentar('Ubicar por dirección sin localidad', async () => {
  psql(`update rutas set zona='[[[[-68.4,-34.6],[-68.3,-34.6],[-68.3,-34.7],[-68.4,-34.7],[-68.4,-34.6]]]]' where nombre='Ruta 1'`);
  await page.goto(BASE + '/admin/rutas');
  await main.getByRole('button', { name: 'Ubicar cuentas por dirección' }).click();
  await page.waitForFunction(() => document.querySelector('main').textContent.includes('Se ubicaron'), null, { timeout: 60000 });
  const u = consultasMapa[0];
  ok('Busca dentro del área de las zonas', u && u.searchParams.get('bounded') === '1' && u.searchParams.get('viewbox')?.split(',').length === 4, u?.search);
  ok('No pide el nombre de la ciudad', u && !u.searchParams.get('q').includes(','), u?.searchParams.get('q'));
});

await intentar('Celular: pendientes no descuenta cuentas de otro', async () => {
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true });
  await ctx.route('http://supabase.test/**', mock);
  page = await ctx.newPage(); page.on('pageerror', (e) => errores.push(e.message)); page.on('dialog', (d) => d.accept());
  main = page.locator('main');
  await page.goto(BASE + '/login');
  await page.getByLabel('Email o usuario').fill('jperez'); await page.getByLabel('Contraseña').fill('secreto');
  await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');
  await main.getByRole('button', { name: 'Descargar cuentas' }).click();
  await main.getByText(/^Listo: \d+ cuentas/).waitFor();
  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  const boton = main.getByRole('button', { name: /^Pendientes \(\d+\)$/ });
  await boton.waitFor();
  await page.waitForFunction(() => document.querySelectorAll('main li').length > 0);
  const n = Number((await boton.textContent()).match(/\d+/)[0]);
  const lista = await main.locator('li').count();
  ok('Pendientes (N) coincide con la lista', n === lista, `${n} vs ${lista}`);
  const resumen = await page.goto(BASE + '/operador').then(() => main.getByRole('region', { name: 'Resumen del día' }).textContent());
  ok('Resumen: pendientes coincide', resumen.includes(`${lista}pendientes`), resumen);
  ok('Encabezado verde con ícono', (await page.locator('header.fondo-marca').count()) === 1 && (await page.getByRole('navigation').locator('svg').count()) === 5);
  ok('Inicio: logo de COOPSAR', (await main.locator('img[src="/logo/coopsar.svg"]').count()) === 1);
  if (CAPT) await page.screenshot({ path: CAPT + '/operador-inicio.png', fullPage: true });
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
