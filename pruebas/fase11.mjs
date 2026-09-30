// Fase 11: pasar pendientes en un clic, etiquetas QR y lector de códigos.
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
      const r = await fetch(`${PGRST}/rpc/cuentas_pendientes?operador_id=eq.${b.reasignar_de}&select=id,operador_id`, { method: 'POST', headers: auth, body: JSON.stringify({ p_periodo_id: periodo }) });
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
psql(`update cuentas set ruta='Ruta 1', operador_id='${JUAN}' where numero_cuenta between '10001' and '10005';
      update cuentas set ruta='Ruta 2', operador_id='${MARIA}' where numero_cuenta between '10006' and '10008';
      insert into periodos (nombre) select 'Octubre 2026' where not exists (select 1 from periodos where activo);`);
const PERIODO = psql('select id from periodos where activo');
psql(`set session_replication_role = replica;
      insert into lecturas (id, periodo_id, cuenta_id, operador_id, lectura_anterior, lectura_actual, fecha_lectura)
      select gen_random_uuid(), '${PERIODO}', id, '${JUAN}', ultima_lectura, ultima_lectura + 10, now() from cuentas where numero_cuenta = '10001';`);
psql('delete from auditoria');

// Video falso para la cámara: un QR con "CUENTA:10003" (formato Y4M que entiende Chromium)
function videoQr(texto, archivo) {
  const QR = requireL('qrcode').create(texto, { errorCorrectionLevel: 'M' }).modules;
  const W = 640, H = 480, px = 10, lado = QR.size * px, x0 = (W - lado) / 2, y0 = (H - lado) / 2;
  const y = Buffer.alloc(W * H, 235);
  for (let f = 0; f < QR.size; f++) for (let c = 0; c < QR.size; c++) if (QR.data[f * QR.size + c])
    for (let dy = 0; dy < px; dy++) y.fill(16, (y0 + f * px + dy) * W + x0 + c * px, (y0 + f * px + dy) * W + x0 + c * px + px);
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const cuadro = Buffer.concat([Buffer.from('FRAME\n'), y, uv]);
  fs.writeFileSync(archivo, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(5).fill(cuadro)]));
}
videoQr('CUENTA:10003', TMP + '/qr.y4m');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${TMP}/qr.y4m`] });
let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', acceptDownloads: true });
await ctx.route('http://supabase.test/**', mock);
let page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
let main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Admin pasa las pendientes de Juan a María', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Operadores' }).click();
  await main.getByRole('button', { name: 'Pasar pendientes de Juan Pérez' }).click();
  const d = page.getByRole('dialog');
  await d.getByText(/tiene 4 cuentas pendientes/).waitFor();
  ok('Pasar pendientes: cuenta las que faltan leer', true);
  const opciones = await d.getByRole('combobox').locator('option').allTextContents();
  ok('Pasar pendientes: no ofrece al mismo operador', !opciones.includes('Juan Pérez') && opciones.includes('María Gómez'), opciones.join(','));
  await d.getByRole('combobox').selectOption({ label: 'María Gómez' });
  if (CAPT) await page.screenshot({ path: CAPT + '/pasar-pendientes.png' });
  await d.getByRole('button', { name: 'Pasar 4 cuentas' }).click();
  await main.getByText('Se pasaron 4 cuentas pendientes.').waitFor();
  const de = psql(`select string_agg(numero_cuenta || '=' || coalesce(p.nombre, '-'), ',' order by numero_cuenta) from cuentas c left join perfiles p on p.id = c.operador_id where ruta = 'Ruta 1'`);
  ok('Pasar pendientes: la leída queda y las otras pasan', de === '10001=Juan Pérez,10002=María Gómez,10003=María Gómez,10004=María Gómez,10005=María Gómez', de);
  ok('Pasar pendientes: se llama a la función con los dos operadores', llamadas.at(-1).reasignar_de === JUAN && llamadas.at(-1).operador_id === MARIA);
  const aud = psql(`select count(*) || '|' || string_agg(distinct usuario_nombre, ',') || '|' || string_agg(distinct accion, ',') from auditoria where tabla='cuentas' and cambios ? 'operador_id'`);
  ok('Historial: registra el cambio con el nombre del admin', aud === '4|Guille Admin|cambio', aud);
});

await intentar('Admin descarga etiquetas QR', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Cuentas' }).click();
  await main.locator('tbody tr').first().waitFor();
  await main.getByLabel('Filtrar por ruta').selectOption('Ruta 1');
  await main.locator('tbody tr', { hasText: '10005' }).waitFor();
  const [descarga] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: 'Etiquetas QR' }).click()]);
  const pdf = fs.readFileSync(await descarga.path()).toString('latin1');
  ok('Etiquetas QR: nombre con la ruta', descarga.suggestedFilename() === 'etiquetas_qr_ruta_1.pdf', descarga.suggestedFilename());
  ok('Etiquetas QR: una por cuenta de la ruta', ['10001', '10002', '10003', '10004', '10005'].every((n) => pdf.includes(`(${n})`)) && !pdf.includes('(10006)'));
  ok('Etiquetas QR: con imágenes de los códigos', (pdf.match(/\/Subtype \/Image/g) ?? []).length === 5);
  await main.getByText('Se descargaron 5 etiquetas').waitFor();
});

await ctx.close();
ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true, permissions: ['camera'] });
await ctx.route('http://supabase.test/**', mock);
page = await ctx.newPage(); main = page.locator('main');
page.on('pageerror', (e) => errores.push(e.message));
await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('mgomez'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');
await main.getByRole('button', { name: 'Descargar cuentas' }).click();
await main.getByText(/Listo: \d+ cuentas guardadas/).waitFor();
ok('María descarga las cuentas que le pasaron', true);

await intentar('Operador escanea el QR del medidor', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).dispatchEvent('click');
  await main.getByRole('button', { name: 'Escanear código' }).click();
  await page.getByRole('dialog').getByLabel('Imagen de la cámara').waitFor();
  if (CAPT) await page.screenshot({ path: CAPT + '/escanear.png' });
  await page.waitForURL(/\/operador\/cuenta\//, { timeout: 15000 });
  const id = psql("select id from cuentas where numero_cuenta = '10003'");
  ok('Escanear: abre la cuenta del QR', page.url().endsWith('/operador/cuenta/' + id), page.url());
  await main.getByText('10003').first().waitFor();
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
