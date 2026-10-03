// Prueba de lecturas en vivo (Realtime simulado), varias rutas por operador y cuenta nueva asignada.
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
psql(`update rutas set operador_id='${JUAN}' where nombre='Ruta 1';
      update cuentas set ruta='Ruta 1', operador_id='${JUAN}' where numero_cuenta between '10001' and '10005';
      update cuentas set ruta='Ruta 2' where numero_cuenta between '10006' and '10008';
      update cuentas set ruta='Ruta 3' where numero_cuenta between '10009' and '10010';
      insert into periodos (nombre) select 'Octubre 2026' where not exists (select 1 from periodos where activo);`);
const PERIODO = psql("select id from periodos where activo");

// ---- Realtime simulado: responde el join y deja mandar cambios de la base
let enviarCambio = null; const unidos = [];
async function simularRealtime(ctx) {
  await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((m) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(m);
      if (event === 'phoenix' || topic === 'phoenix') return ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]));
      if (event === 'phx_join') {
        const filtros = (payload.config?.postgres_changes ?? []).map((f, i) => ({ ...f, id: 100 + i }));
        unidos.push({ topic, filtros, ws });
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: filtros } }]));
        // Hay varios canales (lecturas, mensajes...): el cambio va a los que escuchan esa tabla
        enviarCambio = (table, type, record) => {
          for (const u of unidos) {
            const ids = u.filtros.filter((f) => f.table === table && (f.event === type || f.event === '*')).map((f) => f.id);
            if (ids.length) u.ws.send(JSON.stringify([null, null, u.topic, 'postgres_changes', { ids, data: { schema: 'public', table, type, record, commit_timestamp: new Date().toISOString(), columns: [], errors: null } }]));
          }
        };
        return;
      }
      if (ref) ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' });
await ctx.route('http://supabase.test/**', mock);
await simularRealtime(ctx);
const page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
const main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

function nuevaLectura(numero, valor, fecha, operador = JUAN) {
  const id = crypto.randomUUID();
  const sin = valor === null;
  psql(`insert into lecturas (id, cuenta_id, periodo_id, operador_id, lectura_anterior, lectura_actual, sin_lectura, observacion, fecha_lectura)
        select '${id}', c.id, '${PERIODO}', '${operador}', c.ultima_lectura, ${sin ? 'null' : valor}, ${sin}, ${sin ? "'Medidor tapado'" : 'null'}, '${fecha}'
        from cuentas c where numero_cuenta='${numero}'`);
  return id;
}

await intentar('En vivo: se suscribe a lecturas y conflictos', async () => {
  for (let i = 0; i < 30 && !enviarCambio; i++) await page.waitForTimeout(200);
  const f = unidos.flatMap((u) => u.filtros);
  ok('En vivo: se suscribe a lecturas y conflictos', f.some((x) => x.table === 'lecturas' && x.event === 'INSERT') && f.some((x) => x.table === 'lecturas_conflictos'));
});

await intentar('En vivo: llega una lectura', async () => {
  await main.getByText('Últimas alertas').waitFor();
  ok('En vivo: panel empieza sin alertas', await main.getByText('No hay alertas en este período.').isVisible());
  const id = nuevaLectura('10002', null, '2026-10-05T14:35:00-03:00');
  enviarCambio('lecturas', 'INSERT', { id });
  await page.getByRole('status').filter({ hasText: 'Nueva lectura: cuenta 10002 · Juan Pérez' }).waitFor({ timeout: 5000 });
  ok('En vivo: aparece el cartel de lectura nueva', true);
  ok('En vivo: la campana cuenta 1 sin leer', await page.getByRole('button', { name: 'Avisos: 1 sin leer' }).isVisible());
  await main.locator('li', { hasText: '10002' }).waitFor({ timeout: 5000 });
  const alerta = await main.locator('li', { hasText: '10002' }).textContent();
  ok('Alertas: el panel se actualizó solo y muestra fecha y hora', alerta.includes('05/10/2026') && alerta.includes('14:35') && alerta.includes('Juan Pérez'), alerta);
  if (CAPT) await page.screenshot({ path: CAPT + '/alertas-fecha-hora.png' });
});

await intentar('En vivo: varias lecturas juntas', async () => {
  const ids = [nuevaLectura('10003', 1300, '2026-10-05T15:00:00-03:00', MARIA), nuevaLectura('10004', 1450, '2026-10-05T15:02:00-03:00', MARIA)];
  for (const id of ids) enviarCambio('lecturas', 'INSERT', { id });
  await page.getByRole('status').filter({ hasText: 'Llegaron 2 lecturas nuevas de María Gómez' }).waitFor({ timeout: 5000 });
  ok('En vivo: junta las lecturas de una sincronización', true);
  await page.getByRole('button', { name: 'Avisos: 3 sin leer' }).click();
  const panel = page.getByRole('dialog', { name: 'Avisos de lecturas' });
  await panel.waitFor();
  const filas = panel.locator('li');
  ok('Campana: lista 3 lecturas, la más nueva primero', (await filas.count()) === 3 && (await filas.first().textContent()).includes('10004'));
  const t = await filas.last().textContent();
  ok('Campana: muestra fecha, hora, operador y alerta', t.includes('05/10/2026') && t.includes('14:35') && t.includes('Juan Pérez') && t.includes('Sin lectura'), t);
  if (CAPT) await page.screenshot({ path: CAPT + '/campana-lecturas.png' });
  await page.getByRole('button', { name: 'Avisos', exact: true }).or(page.getByRole('button', { name: /Avisos: \d+ sin leer/ })).first().click();
  ok('Campana: al cerrarla quedan leídas', await page.getByRole('button', { name: 'Avisos', exact: true }).isVisible());
});

await intentar('En vivo: la tabla de Lecturas se refresca', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Lecturas' }).click();
  await main.locator('tbody tr', { hasText: '10004' }).waitFor();
  const antes = await main.locator('tbody tr').count();
  const id = nuevaLectura('10005', 2000, '2026-10-05T16:00:00-03:00');
  enviarCambio('lecturas', 'INSERT', { id });
  await main.locator('tbody tr', { hasText: '10005' }).waitFor({ timeout: 5000 });
  ok('En vivo: Lecturas muestra la nueva sin tocar nada', (await main.locator('tbody tr').count()) === antes + 1);
});

await intentar('Cuenta nueva: toma el operador de la ruta', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Cuentas' }).click();
  await main.getByRole('button', { name: 'Nueva cuenta' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Número de cuenta').fill('20001');
  await d.getByLabel('Titular').fill('Nueva Titular');
  await d.getByLabel('Dirección').fill('Calle 1');
  await d.getByLabel('Medidor').fill('M-20001');
  await d.getByLabel('Ruta').fill('Ruta 3');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await d.getByText('Elegí el operador que va a leer esta cuenta.').waitFor();
  ok('Cuenta nueva: exige elegir operador', true);
  await d.getByLabel('Ruta').fill('Ruta 1');
  ok('Cuenta nueva: al elegir Ruta 1 se elige Juan solo', (await d.getByLabel('Operador').inputValue()) === JUAN);
  llamadas.length = 0;
  await d.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText('Cuenta 20001 creada.').waitFor();
  const l = llamadas.at(-1);
  ok('Cuenta nueva: se asigna a Juan y se le avisa', l?.operador_id === JUAN && l?.cuenta_ids?.length === 1, JSON.stringify(l));
  ok('Cuenta nueva: quedó de Juan en la base', psql("select operador_id from cuentas where numero_cuenta='20001'") === JUAN);
});

await intentar('Editar una cuenta asignada avisa al operador', async () => {
  llamadas.length = 0;
  await main.getByPlaceholder('Buscar por número, titular, dirección o medidor').fill('10001');
  await main.locator('tbody tr', { hasText: '10001' }).getByRole('button', { name: 'Editar' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Titular').fill('Titular Cambiado');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText('Cuenta 10001 actualizada.').waitFor();
  const l = llamadas.at(-1);
  ok('Editar: avisa "actualizadas" al operador', l?.avisar === 'actualizadas' && l.cuenta_ids.length === 1, JSON.stringify(l));
});

await intentar('Operador con varias rutas', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Operadores' }).click();
  const fila = main.getByRole('article', { name: 'María Gómez' });
  await fila.getByRole('button', { name: 'Asignar rutas' }).click();
  const d = page.getByRole('dialog');
  await d.getByText('Rutas de María Gómez').waitFor();
  await d.getByLabel(/^Ruta 2 \(/).check();
  await d.getByLabel(/^Ruta 3 \(/).check();
  if (CAPT) await page.screenshot({ path: CAPT + '/rutas-operador.png' });
  llamadas.length = 0;
  await d.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText(/Se asignaron/).waitFor();
  const l = llamadas.at(-1);
  ok('Varias rutas: una sola llamada con las dos rutas', llamadas.length === 1 && JSON.stringify(l.rutas) === '["Ruta 2","Ruta 3"]' && l.operador_id === MARIA, JSON.stringify(llamadas));
  await fila.getByText('Ruta 3').waitFor();
  ok('Varias rutas: la fila muestra Ruta 2 y Ruta 3', (await fila.textContent()).includes('Ruta 2'));
  ok('Varias rutas: la base quedó con 5 cuentas de María', psql(`select count(*) from cuentas where operador_id='${MARIA}'`) === '5');
  await fila.getByRole('button', { name: 'Cambiar' }).click();
  await d.getByLabel(/^Ruta 2 \(/).uncheck();
  await d.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText('Ruta 2 quedó sin asignar.').waitFor();
  ok('Varias rutas: quitar una la deja sin asignar', psql("select count(*) from cuentas where ruta='Ruta 2' and operador_id is null") === '3');
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
