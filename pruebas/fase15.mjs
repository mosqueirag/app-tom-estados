// Fase 15: zonas de rutas desde KML/KMZ, ubicar cuentas por dirección y asignación por zona.
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

const JUAN = 'bbbbbbbb-0000-0000-0000-000000000002';
const MARIA = 'bbbbbbbb-0000-0000-0000-000000000003';
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Rutas</name>
<Folder><name>Zonas</name>
<Placemark><name>Zona 1 - Centro</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-68.40,-34.70,0 -68.30,-34.70,0 -68.30,-34.60,0 -68.40,-34.60,0 -68.40,-34.70,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Ruta 2</name><MultiGeometry><Polygon><outerBoundaryIs><LinearRing><coordinates>
-68.30,-34.70 -68.20,-34.70 -68.20,-34.60 -68.30,-34.60 -68.30,-34.70
</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>
-68.26,-34.66 -68.24,-34.66 -68.24,-34.64 -68.26,-34.64 -68.26,-34.66
</coordinates></LinearRing></innerBoundaryIs></Polygon></MultiGeometry></Placemark>
<Placemark><name>Oficina</name><Point><coordinates>-68.33,-34.61,0</coordinates></Point></Placemark>
</Folder></Document></kml>`;
fs.writeFileSync(`${TMP}/zonas.kml`, KML);
// KMZ = ZIP comprimido con doc.kml adentro
execFileSync('python3', ['-c', `import zipfile\nwith zipfile.ZipFile('${TMP}/zonas.kmz','w',zipfile.ZIP_DEFLATED) as z: z.write('${TMP}/zonas.kml','doc.kml')`]);
fs.writeFileSync(`${TMP}/solo-punto.kml`, '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>X</name><Point><coordinates>-68,-34</coordinates></Point></Placemark></kml>');

psql(`update rutas set operador_id='${JUAN}' where nombre='Ruta 1'; update rutas set operador_id='${MARIA}' where nombre='Ruta 2';
      update configuracion set localidad='San Rafael, Mendoza' where id=1`);

// Direcciones simuladas: 3 en la zona 1, 2 en la zona 2, 1 en el agujero de la zona 2, el resto no se encuentra
const UBICACIONES = {
  'Av. San Martín 1250': [-34.62, -68.38], 'Belgrano 845': [-34.65, -68.35], 'Mitre 312, Dpto. 2': [-34.68, -68.32],
  'Rivadavia 2030': [-34.62, -68.22], 'Sarmiento 77': [-34.68, -68.28], '25 de Mayo 1540': [-34.65, -68.25],
};
const consultasMapa = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-AR' });
await ctx.route('http://supabase.test/**', mock);
await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 204 }));
await ctx.route('https://nominatim.openstreetmap.org/**', (r) => {
  const q = new URL(r.request().url()).searchParams.get('q');
  consultasMapa.push(q);
  const dir = Object.keys(UBICACIONES).find((d) => q === `${d}, San Rafael, Mendoza`);
  return json(r, 200, dir ? [{ lat: String(UBICACIONES[dir][0]), lon: String(UBICACIONES[dir][1]) }] : []);
});
const page = await ctx.newPage();
const main = page.locator('main');
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
const fila = (n) => psql(`select ruta || '|' || coalesce(operador_id::text,'-') from cuentas where numero_cuenta='${n}'`);

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');
await page.goto(BASE + '/admin/rutas');

await intentar('Importar KML', async () => {
  await main.getByText('0 de 20 rutas con zona · 10 cuentas sin ubicación').waitFor();
  ok('Zonas: muestra cuántas rutas tienen zona y cuentas sin ubicación', true);
  await main.getByRole('button', { name: 'Importar KML' }).click();
  const d = page.getByRole('dialog');
  await d.locator('input[type=file]').setInputFiles(`${TMP}/solo-punto.kml`);
  await d.getByText(/no tiene zonas/).waitFor();
  ok('KML sin polígonos: avisa que no tiene zonas', true);
  await d.locator('input[type=file]').setInputFiles(`${TMP}/zonas.kmz`);
  await d.getByRole('list', { name: 'Zonas del archivo' }).waitFor();
  ok('KMZ: lee las 2 zonas (ignora el punto)', (await d.getByRole('list', { name: 'Zonas del archivo' }).getByRole('listitem').count()) === 2);
  ok('KMZ: "Zona 1 - Centro" se sugiere como Ruta 1', (await d.getByLabel('Ruta de la zona Zona 1 - Centro').inputValue()) === 'Ruta 1');
  ok('KMZ: "Ruta 2" se sugiere como Ruta 2', (await d.getByLabel('Ruta de la zona Ruta 2').inputValue()) === 'Ruta 2');
  ok('KMZ: muestra la vista previa en el mapa', (await d.locator('.leaflet-overlay-pane path').count()) === 2);
  if (CAPT) await page.screenshot({ path: CAPT + '/importar-kml.png' });
  await d.getByRole('button', { name: 'Guardar zonas' }).click();
  await main.getByText(/Se guardaron las zonas de 2 rutas: Ruta 1, Ruta 2/).waitFor();
  const z = psql(`select string_agg(nombre || ':' || jsonb_array_length(zona) || ':' || jsonb_array_length(zona->0), ',' order by nombre) from rutas where zona is not null`);
  ok('Zonas guardadas en la base (Ruta 2 con su agujero)', z === 'Ruta 1:1:1,Ruta 2:1:2', z);
  ok('Zonas: no cambia el operador de la ruta', psql(`select operador_id from rutas where nombre='Ruta 1'`) === JUAN);
  await main.getByText('2 de 20 rutas con zona').waitFor();
  ok('Rutas: marca las rutas con zona', (await main.getByRole('row', { name: /^Ruta 1 Zona/ }).count()) === 1);
});

await intentar('Ubicar cuentas por dirección', async () => {
  await main.getByRole('button', { name: 'Ubicar cuentas por dirección' }).click();
  await main.getByText(/Ubicando cuentas por dirección/).waitFor();
  ok('Ubicar: muestra el avance', true);
  await main.getByText(/Se ubicaron 6 de 10 cuentas por su dirección/).waitFor({ timeout: 40000 });
  ok('Ubicar: busca con la localidad', consultasMapa.includes('Av. San Martín 1250, San Rafael, Mendoza') && consultasMapa.length === 10, consultasMapa.slice(0, 2).join(' | '));
  ok('Ubicar: guarda la ubicación', psql(`select latitud || ',' || longitud from cuentas where numero_cuenta='10001'`) === '-34.62,-68.38');
  ok('Cuenta sin ruta ubicada en la zona 1 pasa a Ruta 1 y a Juan', fila('10001') === `Ruta 1|${JUAN}` && fila('10003') === `Ruta 1|${JUAN}`, fila('10001'));
  ok('Cuenta ubicada en la zona 2 pasa a Ruta 2 y a María', fila('10004') === `Ruta 2|${MARIA}`, fila('10004'));
  ok('Cuenta en el agujero de la zona 2 queda sin ruta', fila('10006') === '|-', fila('10006'));
  ok('Cuenta no encontrada queda como estaba', fila('10007') === '|-');
});

await intentar('Asignar y reasignar por zona', async () => {
  await main.getByRole('button', { name: 'Asignar cuentas por zona' }).click();
  await main.getByText(/No hubo cuentas para cambiar de ruta\. 4 no tienen ubicación.*1 queda fuera de todas las zonas/).waitFor();
  ok('Asignar: informa sin ubicación y fuera de zona', true);
  psql(`update cuentas set ruta='Ruta 9' where numero_cuenta='10002'`);
  ok('Una cuenta con ruta puesta a mano no se toca sola', fila('10002') === 'Ruta 9|-');
  const antes = llamadas.length;
  await main.getByRole('button', { name: 'Reasignar todas por zona' }).click();
  await main.getByText(/Listo: 1 cuenta pasó a la ruta de su zona/).waitFor();
  ok('Reasignar: vuelve a la ruta de su zona y su operador', fila('10002') === `Ruta 1|${JUAN}`, fila('10002'));
  ok('Reasignar: avisa al operador', llamadas.slice(antes).some((l) => l.avisar === 'nuevas' && l.cuenta_ids.length === 1));
});

await intentar('Ver mapa de zonas', async () => {
  await main.getByRole('button', { name: 'Ver mapa' }).click();
  await main.getByRole('region', { name: 'Mapa de zonas' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('main .leaflet-overlay-pane path').length >= 8);
  ok('Mapa: zonas y cuentas ubicadas', (await main.locator('.leaflet-overlay-pane path').count()) === 2 + 6);
  if (CAPT) await page.screenshot({ path: CAPT + '/zonas-mapa.png', fullPage: true });
});

await intentar('GPS del operador', async () => {
  psql(`update cuentas set latitud=-34.61, longitud=-68.21 where numero_cuenta='10008'`);
  ok('Cuenta sin ruta que recibe GPS en la zona 2 pasa a María', fila('10008') === `Ruta 2|${MARIA}`, fila('10008'));
  psql(`insert into cuentas (numero_cuenta, titular, direccion, medidor, latitud, longitud) values ('20001','Nueva','X 1','M',-34.65,-68.35)`);
  ok('Cuenta nueva con ubicación toma la ruta de su zona', fila('20001') === `Ruta 1|${JUAN}`);
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
await browser.close();
console.log(resultados.join('\n'));
console.log(`\n${resultados.filter((r) => r.startsWith('✓')).length}/${resultados.length} OK`);
