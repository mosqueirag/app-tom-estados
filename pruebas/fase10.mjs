// Fase 10: historial de consumo, reporte PDF y copia de seguridad.
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
const ACTIVO = psql("select id from periodos where activo");
// Tres períodos viejos cerrados con lecturas de la cuenta 10001, más una del período activo
psql(`set session_replication_role = replica; -- datos armados a mano: sin triggers
  update cuentas set ruta='Ruta 1' where numero_cuenta between '10001' and '10005';
  insert into periodos (id, nombre, fecha_inicio, fecha_cierre, activo) values
   ('00000000-0000-0000-0000-00000000000a','Julio 2026','2026-07-01','2026-07-31',false),
   ('00000000-0000-0000-0000-00000000000b','Agosto 2026','2026-08-01','2026-08-31',false),
   ('00000000-0000-0000-0000-00000000000c','Septiembre 2026','2026-09-01','2026-09-30',false);
  insert into lecturas (id, cuenta_id, periodo_id, operador_id, lectura_anterior, lectura_actual, fecha_lectura)
  select gen_random_uuid(), c.id, p.id, '${JUAN}', v.ant, v.act, v.f::timestamptz
  from cuentas c, (values ('00000000-0000-0000-0000-00000000000a'::uuid, 15000, 15100, '2026-07-10 10:00-03'),
                          ('00000000-0000-0000-0000-00000000000b'::uuid, 15100, 15190, '2026-08-10 10:00-03'),
                          ('00000000-0000-0000-0000-00000000000c'::uuid, 15190, 15230, '2026-09-10 10:00-03')) v(p, ant, act, f)
  join periodos p on p.id = v.p where c.numero_cuenta='10001';
  insert into lecturas (id, cuenta_id, periodo_id, operador_id, lectura_anterior, lectura_actual, fecha_lectura)
  select gen_random_uuid(), c.id, '${ACTIVO}', '${JUAN}', 15230, 15600, '2026-10-05 11:20-03' from cuentas c where numero_cuenta='10001';
  update lecturas l set lectura_anterior = l.lectura_actual - v.consumo
  from (values ('00000000-0000-0000-0000-00000000000a'::uuid, 100), ('00000000-0000-0000-0000-00000000000b'::uuid, 90),
               ('00000000-0000-0000-0000-00000000000c'::uuid, 40)) v(p, consumo) where l.periodo_id = v.p;
  update lecturas set lectura_anterior = 15230 where periodo_id='${ACTIVO}' and lectura_actual = 15600;
  insert into lecturas (id, cuenta_id, periodo_id, operador_id, lectura_anterior, sin_lectura, observacion, fecha_lectura)
  select gen_random_uuid(), c.id, '${ACTIVO}', '${JUAN}', c.ultima_lectura, true, 'Perro', '2026-10-05 11:40-03' from cuentas c where numero_cuenta='10002';`);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', acceptDownloads: true });
await ctx.route('http://supabase.test/**', mock);
const page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
const main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Historial', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Cuentas' }).click();
  await main.locator('tbody tr', { hasText: '10001' }).getByRole('button', { name: 'Historial' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('img', { name: 'Gráfico de consumo por período' }).waitFor();
  ok('Historial: gráfico con una barra por período', (await d.locator('svg rect').count()) === 4);
  const t = await d.textContent();
  ok('Historial: tabla con los 4 períodos y consumos', ['Julio 2026', 'Agosto 2026', 'Septiembre 2026', 'Octubre 2026'].every((p) => t.includes(p)) && t.includes('370'), t.slice(0, 200));
  ok('Historial: marca el consumo raro (más del doble del promedio)', (await d.locator('svg rect.fill-amber-500').count()) === 1);
  ok('Historial: muestra el promedio', t.includes('consumo promedio'));
  if (CAPT) await page.screenshot({ path: CAPT + '/historial.png' });
  await d.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Lecturas' }).click();
  await main.locator('tbody tr', { hasText: '10001' }).getByRole('button', { name: 'Historial' }).click();
  await page.getByRole('dialog').getByText('Historial de consumo · 10001').waitFor();
  ok('Historial: también desde Lecturas', true);
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
});

await intentar('Reporte PDF', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Períodos' }).click();
  const fila = main.locator('tbody tr', { hasText: 'Octubre 2026' });
  const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), fila.getByRole('button', { name: 'Reporte PDF' }).click()]);
  const ruta = await descarga.path();
  const pdf = fs.readFileSync(ruta);
  fs.copyFileSync(ruta, TMP + '/reporte.pdf');
  ok('Reporte: descarga un PDF', descarga.suggestedFilename() === 'reporte_octubre_2026.pdf' && pdf.subarray(0, 5).toString() === '%PDF-', descarga.suggestedFilename());
  // jsPDF deja el texto sin comprimir: se busca directo en el archivo
  const texto = pdf.toString('latin1').replaceAll('\\(', '(').replaceAll('\\)', ')');
  ok('Reporte: resumen, rutas, operadores, alertas y pendientes', ['Reporte de lecturas · Octubre 2026', 'Por ruta', 'Por operador', 'Alertas (2)', 'Conflictos', 'Cuentas sin leer (8)', 'Juan Pérez', 'Sin lectura: Perro'].every((x) => texto.includes(x)), texto.slice(0, 300));
  ok('Reporte: fecha y hora de cada alerta', texto.includes('05/10/2026, 11:40'));
});

await intentar('Copia de seguridad', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Panel' }).click();
  const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), main.getByRole('button', { name: 'Descargar copia de seguridad' }).dispatchEvent('click')]);
  const libro = XLSX.readFile(await descarga.path());
  ok('Copia: una hoja por tabla', ['cuentas', 'periodos', 'lecturas', 'lecturas_conflictos', 'lecturas_correcciones', 'perfiles', 'configuracion'].every((h) => libro.SheetNames.includes(h)), libro.SheetNames.join(','));
  const n = (h) => XLSX.utils.sheet_to_json(libro.Sheets[h]).length;
  ok('Copia: trae todas las filas', n('cuentas') === Number(psql('select count(*) from cuentas')) && n('lecturas') === Number(psql('select count(*) from lecturas')) && n('periodos') === 4, `${n('cuentas')} cuentas, ${n('lecturas')} lecturas`);
  await main.getByText(/Copia descargada: \d+ cuentas/).waitFor();
  ok('Copia: avisa lo que descargó', true);
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
