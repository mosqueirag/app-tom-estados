// Fase 14: logo original, panel con carga rápida y rutas con operador fijo.
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

const JUAN = 'bbbbbbbb-0000-0000-0000-000000000002';
const MARIA = 'bbbbbbbb-0000-0000-0000-000000000003';
const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR' });
await ctx.route('http://supabase.test/**', mock);
const page = await ctx.newPage();
const main = page.locator('main');
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());

await intentar('Logo original', async () => {
  await page.goto(BASE + '/login');
  const src = await page.locator('header img').first().getAttribute('src');
  ok('Login: muestra el logo original de la app', src === '/icons/icono.svg', src);
  await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
  await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');
  ok('Admin: el encabezado usa el logo original', (await page.locator('aside img').first().getAttribute('src')) === '/icons/icono.svg');
  ok('Ya no aparece el logo de COOPSAR', (await page.locator('img[src*="coopsar"]').count()) === 0);
});

await intentar('Panel: accesos rápidos y aviso de rutas', async () => {
  const accesos = page.getByRole('group', { name: 'Accesos rápidos' });
  await accesos.waitFor();
  ok('Panel: 6 accesos rápidos', (await accesos.getByRole('link').count()) === 6);
  ok('Panel: avisa las rutas sin operador', await main.getByText('Hay 20 rutas sin operador').isVisible());
  if (CAPT) await page.screenshot({ path: CAPT + '/panel.png', fullPage: true });
});

await intentar('Carga rápida de lecturas', async () => {
  const numero = main.getByLabel('Número de cuenta para carga rápida');
  await main.getByRole('group', { name: 'Accesos rápidos' }).getByRole('link', { name: 'Cargar lecturas' }).click();
  ok('Carga rápida: "Cargar lecturas" pone el cursor en el número', await numero.evaluate((e) => e === document.activeElement));
  await numero.fill('10001');
  await main.getByText('anterior 15.230').waitFor();
  await numero.press('Enter');
  ok('Carga rápida: Enter pasa a la lectura', await main.getByLabel('Lectura para carga rápida').evaluate((e) => e === document.activeElement));
  await main.getByLabel('Lectura para carga rápida').fill('15300');
  await main.getByLabel('Lectura para carga rápida').press('Enter');
  await main.getByRole('list', { name: 'Lecturas cargadas recién' }).getByText('10001').waitFor();
  const fila = psql(`select lectura_actual::int || '|' || l.operador_id from lecturas l join cuentas c on c.id=l.cuenta_id where c.numero_cuenta='10001'`);
  ok('Carga rápida: la lectura queda guardada a nombre del admin', fila === `15300|${ADMIN}`, fila);
  ok('Carga rápida: muestra el consumo', await main.getByText('15.300 · consumo 70').isVisible());
  ok('Carga rápida: vuelve al número', await numero.evaluate((e) => e === document.activeElement && e.value === ''));
  await main.getByText('Hoy: 1 lectura').waitFor({ timeout: 5000 });
  ok('Panel: cuenta las lecturas de hoy', true);

  await numero.fill('10001');
  await main.getByText(/Ya tiene lectura en este período/).waitFor();
  ok('Carga rápida: no deja cargar dos veces la misma cuenta', await main.getByRole('button', { name: 'Guardar lectura' }).isDisabled());
  await numero.fill('99999');
  await main.getByText('No existe la cuenta 99999.').waitFor();
  ok('Carga rápida: avisa si la cuenta no existe', true);

  await numero.fill('10002');
  await main.getByText('anterior 8.741').waitFor();
  await main.getByLabel('No se pudo leer').check();
  await main.getByLabel('Observación para carga rápida').fill('Perro suelto');
  await main.getByRole('button', { name: 'Guardar lectura' }).click();
  await main.getByText('sin lectura: Perro suelto').waitFor();
  ok('Carga rápida: también carga "sin lectura" con motivo', psql(`select sin_lectura || observacion from lecturas l join cuentas c on c.id=l.cuenta_id where c.numero_cuenta='10002'`) === 'truePerro suelto');
});

await intentar('Accesos rápidos abren el formulario', async () => {
  await main.getByRole('group', { name: 'Accesos rápidos' }).getByRole('link', { name: 'Nueva cuenta' }).click();
  await page.waitForURL(/\/admin\/cuentas/);
  await page.getByRole('dialog').waitFor();
  ok('Nueva cuenta: abre el formulario directo', await page.getByRole('dialog').getByText(/cuenta/i).first().isVisible());
  await page.keyboard.press('Escape');
  await page.goto(BASE + '/admin/operadores?accion=mensaje');
  await page.getByRole('dialog').waitFor();
  ok('Mandar mensaje: abre el mensaje directo', true);
});

await intentar('Rutas: 20 rutas y asignación manual', async () => {
  await page.goto(BASE + '/admin/rutas');
  await main.getByRole('combobox', { name: 'Operador de Ruta 20', exact: true }).waitFor();
  const nombres = (await main.locator('tbody tr td:first-child').allTextContents()).map((t) => t.trim());
  ok('Rutas: aparecen las 20 rutas en orden', nombres.slice(0, 20).join(',') === Array.from({ length: 20 }, (_, i) => `Ruta ${i + 1}`).join(','), nombres.slice(0, 12).join(','));
  await main.getByRole('combobox', { name: 'Operador de Ruta 1', exact: true }).selectOption({ label: 'Juan Pérez' });
  await main.getByRole('combobox', { name: 'Operador de Ruta 2', exact: true }).selectOption({ label: 'Juan Pérez' });
  await main.getByRole('combobox', { name: 'Operador de Ruta 3', exact: true }).selectOption({ label: 'María Gómez' });
  ok('Rutas: muestra los cambios sin guardar', await page.getByText('3 rutas cambiadas').isVisible());
  ok('Rutas: el resumen muestra cómo queda', (await main.getByRole('list', { name: 'Rutas por operador' }).textContent()).includes('Ruta 1, Ruta 2'));
  const antes = llamadas.length;
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByText('3 rutas cambiadas').waitFor({ state: 'hidden' });
  const nuevas = llamadas.slice(antes);
  ok('Rutas: un pedido por operador', nuevas.length === 2 && nuevas.some((l) => l.operador_id === JUAN && l.rutas.join() === 'Ruta 1,Ruta 2'), JSON.stringify(nuevas));
  const guardado = psql(`select string_agg(nombre || '=' || coalesce(operador_id::text,'-'), ',' order by nombre) from rutas where operador_id is not null`);
  ok('Rutas: queda guardado el operador de cada ruta', guardado === `Ruta 1=${JUAN},Ruta 2=${JUAN},Ruta 3=${MARIA}`, guardado);
  await main.getByText('17 sin operador').waitFor();
  ok('Rutas: cuenta las rutas sin operador', true);
  if (CAPT) await page.screenshot({ path: CAPT + '/rutas.png', fullPage: true });
});

await intentar('Cuentas nuevas toman el operador de su ruta', async () => {
  psql(`update cuentas set ruta='Ruta 1' where numero_cuenta='10003'`);
  ok('Cambiar la ruta de una cuenta la pasa al operador de la ruta', psql(`select operador_id from cuentas where numero_cuenta='10003'`) === JUAN);
  psql(`insert into cuentas (numero_cuenta, titular, direccion, medidor, ruta) values ('20001', 'Nueva', 'Calle 1', 'M-1', ' Ruta 3 ')`);
  ok('Una cuenta nueva (Excel o formulario) va sola al operador de su ruta', psql(`select ruta || '|' || operador_id from cuentas where numero_cuenta='20001'`) === `Ruta 3|${MARIA}`);
  psql(`update cuentas set ruta='Ruta 9' where numero_cuenta='10003'`);
  ok('Pasar a una ruta sin operador la deja sin asignar', psql(`select coalesce(operador_id::text,'-') from cuentas where numero_cuenta='10003'`) === '-');
});

await intentar('Operadores: rutas de cada uno', async () => {
  await page.goto(BASE + '/admin/operadores');
  const fila = main.getByRole('row', { name: /Juan Pérez/ });
  await fila.getByText('Ruta 2').waitFor();
  ok('Operadores: Juan tiene Ruta 1 y Ruta 2', (await fila.textContent()).includes('Ruta 1'));
  await main.getByRole('row', { name: /María Gómez/ }).getByRole('button', { name: 'Cambiar' }).click();
  const d = page.getByRole('dialog');
  ok('Operadores: el modal lista las 20 rutas', (await d.getByRole('checkbox').count()) >= 20);
  await d.getByRole('checkbox', { name: /Ruta 15/ }).check();
  await d.getByRole('button', { name: 'Guardar' }).click();
  await d.waitFor({ state: 'hidden' });
  ok('Operadores: asignar una ruta vacía desde el operador', psql(`select operador_id from rutas where nombre='Ruta 15'`) === MARIA);
});

await intentar('Agregar y borrar una ruta', async () => {
  await page.goto(BASE + '/admin/rutas');
  await main.getByLabel('Nombre de la ruta nueva').fill('Ruta 21');
  await main.getByRole('button', { name: 'Agregar' }).click();
  await main.getByRole('combobox', { name: 'Operador de Ruta 21', exact: true }).waitFor();
  ok('Rutas: se agrega la Ruta 21', psql(`select count(*) from rutas where nombre='Ruta 21'`) === '1');
  await main.getByRole('button', { name: 'Borrar Ruta 21' }).click();
  await main.getByRole('combobox', { name: 'Operador de Ruta 21', exact: true }).waitFor({ state: 'detached' });
  ok('Rutas: se borra una ruta vacía', psql(`select count(*) from rutas where nombre='Ruta 21'`) === '0');
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
