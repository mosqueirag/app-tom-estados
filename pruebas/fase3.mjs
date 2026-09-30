// Prueba de punta a punta del módulo administrador contra PostgREST + Postgres reales.
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
  return json(route, 404, { message: 'sin mock ' + url.pathname });
}

async function rpcOperador(email, lecturas) {
  const r = await fetch(`${PGRST}/rpc/sincronizar_lecturas`, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(USERS[email], email), 'Content-Type': 'application/json' }, body: JSON.stringify({ p_lecturas: lecturas }) });
  return r.json();
}

const resultados = [];
const ok = (n, c, extra = '') => resultados.push(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`);
const intentar = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message.split('\n')[0]); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-AR', acceptDownloads: true });
await ctx.route('http://supabase.test/**', mock);
const page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());
const main = page.locator('main');

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('admin@x.com'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/admin');

await intentar('Panel sin lecturas', async () => {
  await main.getByText('Octubre 2026').waitFor();
  ok('Panel: período activo y "0 de 10 cuentas leídas"', (await main.textContent()).includes('0 de 10 cuentas leídas'));
});

// ---------- Cuentas
await intentar('Cuentas', async () => {
  await page.getByRole('link', { name: 'Cuentas' }).click();
  await main.getByText('García, María Laura').waitFor();
  ok('Cuentas: lista las 10 de ejemplo', (await main.locator('tbody tr').count()) === 10);
  await main.getByPlaceholder('Buscar por número').fill('garcía');
  await page.waitForTimeout(800);
  ok('Cuentas: búsqueda por titular', (await main.locator('tbody tr').count()) === 1);
  await main.getByPlaceholder('Buscar por número').fill('');
  await page.getByRole('button', { name: 'Nueva cuenta' }).click();
  const d = page.locator('dialog[open]');
  await d.getByLabel('Número de cuenta').fill('10011'); await d.getByLabel('Titular').fill('Acosta, Pedro');
  await d.getByLabel('Dirección').fill('Italia 55'); await d.getByLabel('Medidor').fill('MED-1'); await d.getByLabel('Última lectura').fill('1.500,5');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText('Cuenta 10011 creada.').waitFor();
  ok('Cuentas: alta manual (lectura con formato 1.500,5)', psql("select ultima_lectura from cuentas where numero_cuenta='10011'") === '1500.500');
  await main.locator('tr', { hasText: '10011' }).getByRole('button', { name: 'Editar' }).click();
  ok('Cuentas: con período abierto no se edita la última lectura', await d.getByLabel('Última lectura').isDisabled());
  await d.getByLabel('Titular').fill('Acosta, Pedro J.'); await d.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText('Cuenta 10011 actualizada.').waitFor();
  await main.locator('tr', { hasText: '10011' }).getByRole('button', { name: 'Dar de baja' }).click();
  await main.getByText('Cuenta 10011 dada de baja.').waitFor();
  ok('Cuentas: edición y baja', psql("select titular||'|'||activa from cuentas where numero_cuenta='10011'") === 'Acosta, Pedro J.|false');

  const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar plantilla' }).click()]);
  const plantilla = XLSX.readFile(await descarga.path());
  const enc = XLSX.utils.sheet_to_json(plantilla.Sheets[plantilla.SheetNames[0]], { header: 1 })[0];
  ok('Plantilla Excel con las 6 columnas (incluye ruta)', descarga.suggestedFilename() === 'plantilla_cuentas.xlsx' && enc.join(',') === 'numero_cuenta,titular,direccion,medidor,ultima_lectura,ruta');
});

// ---------- Importar
await intentar('Importar', async () => {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([
    ['Numero Cuenta', 'Titular', 'Dirección', 'Medidor', 'Ultima_Lectura'],
    [20001, 'Nuevo, Uno', 'Calle 1', 'M-20001', 100],
    ['20002', 'Nuevo, Dos', 'Calle 2', 'M-20002', '1.234,5'],
    ['10001', 'García, María L.', 'Av. San Martín 1250', 'MED-458721', 99999],
    ['10002', 'Fernández, Juan Carlos', 'Belgrano 845', 'MED-458722', 8741],
    ['20001', 'Repetido', 'Calle 3', 'M-3', 5],
    ['20003', '', 'Calle 4', 'M-4', 5],
    ['20004', 'Número malo', 'Calle 5', 'M-5', 'abc'],
    ['10011', 'Acosta, Pedro J.', 'Italia 55', 'MED-1', 1500.5],
  ]), 'Hoja1');
  const ruta = `${TMP}/cuentas.xlsx`; XLSX.writeFile(libro, ruta);
  await page.getByRole('button', { name: 'Importar Excel' }).click();
  const d = page.locator('dialog[open]');
  await d.locator('input[type=file]').setInputFiles(ruta);
  await d.getByRole('button', { name: /^Importar \d+ cuenta/ }).waitFor();
  const texto = await d.textContent();
  ok('Importar: vista previa detecta nuevas/actualizar/sin cambios/errores',
    texto.includes('Nueva (2)') && texto.includes('Se actualiza (2)') && texto.includes('Sin cambios (1)') && texto.includes('Error (3)'),
    texto.match(/Todas \(\d+\).*?(?=Fila)/)?.[0]);
  ok('Importar: marca duplicado, vacío y número inválido',
    texto.includes('Número de cuenta repetido (también está en la fila 2)') && texto.includes('Falta el titular') && texto.includes('"abc" no es un número'));
  ok('Importar: avisa que no cambia la última lectura con período abierto', texto.includes('Hay un período abierto: la última lectura no se cambia.'));
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase3-importar.png` });
  await d.getByRole('button', { name: 'Importar 4 cuentas' }).click();
  await d.getByText('Listo: 2 cuentas nuevas y 2 actualizadas.').waitFor();
  ok('Importar: guarda en la base',
    psql("select string_agg(numero_cuenta||'='||ultima_lectura||'/'||titular||'/'||activa, ' ; ' order by numero_cuenta) from cuentas where numero_cuenta in ('20001','20002','10001','10011')")
      === '10001=15230.000/García, María L./true ; 10011=1500.500/Acosta, Pedro J./true ; 20001=100.000/Nuevo, Uno/true ; 20002=1234.500/Nuevo, Dos/true');
  await d.getByRole('button', { name: 'Cerrar' }).click();
});

// ---------- Lecturas cargadas por operadores (vía la misma RPC que usará el celular)
const per = psql('select id from periodos where activo');
const cta = (n) => psql(`select id from cuentas where numero_cuenta='${n}'`);
const L = (id, n, v, extra = {}) => ({ id, cuenta_id: cta(n), periodo_id: per, lectura_actual: v, fecha_lectura: '2026-10-05T10:00:00-03:00', ...extra });
const r1 = await rpcOperador('jperez@usuarios.lecturas.app', [
  L('11111111-0000-0000-0000-000000000001', '10001', 15262),
  L('11111111-0000-0000-0000-000000000002', '10004', 3220),
  L('11111111-0000-0000-0000-000000000003', '10010', 120),
  L('11111111-0000-0000-0000-000000000004', '10003', null, { sin_lectura: true, observacion: 'Perro suelto' }),
]);
const r2 = await rpcOperador('mgomez@usuarios.lecturas.app', [L('22222222-0000-0000-0000-000000000001', '10001', 15270), L('22222222-0000-0000-0000-000000000002', '10005', 12000)]);
ok('RPC sincronizar_lecturas vía PostgREST', r1.every((x) => x.estado === 'sincronizada') && r2[0].estado === 'conflicto' && r2[1].estado === 'sincronizada', JSON.stringify(r2.map((x) => x.estado)));

await intentar('Panel con datos', async () => {
  await page.getByRole('link', { name: 'Panel' }).click();
  await main.getByText('5 de 13 cuentas leídas').waitFor();
  const t = await main.textContent();
  ok('Panel: progreso, alertas y conflictos', t.includes('Menor a la anterior') && t.includes('Consumo anómalo') && /Conflictos\s*1/.test(t));
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase3-panel.png`, fullPage: true });
  await main.getByLabel('Umbral de consumo anómalo').fill('2,5'); await main.getByRole('button', { name: 'Guardar' }).click();
  await main.getByText('Umbral guardado').waitFor();
  ok('Panel: umbral configurable', psql('select umbral_consumo_anomalo from configuracion') === '2.50');
});

await intentar('Lecturas', async () => {
  await main.getByRole('link', { name: /Menor a la anterior/ }).click();
  await page.waitForURL(/alerta=menor_anterior/);
  await main.locator('tbody tr').first().waitFor();
  ok('Lecturas: filtro "menor a la anterior" desde el panel', (await main.locator('tbody tr').count()) === 1 && (await main.locator('tbody').textContent()).includes('10010'));
  await main.getByLabel('Alertas').selectOption('todas');
  await page.waitForTimeout(500);
  ok('Lecturas: sin filtro muestra 5', (await main.locator('tbody tr').count()) === 5);
  await main.getByLabel('Operador').selectOption({ label: 'María Gómez' });
  await page.waitForTimeout(500);
  ok('Lecturas: filtro por operador', (await main.locator('tbody tr').count()) === 1);
  await main.getByLabel('Operador').selectOption('');
  await page.waitForTimeout(500);
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase3-lecturas.png` });

  await main.locator('tr', { hasText: '10004' }).getByRole('button', { name: 'Corregir' }).click();
  const d = page.locator('dialog[open]');
  await d.getByLabel('Lectura actual').fill('3150'); await d.getByLabel('Observación').fill('Error de tipeo');
  await d.getByRole('button', { name: 'Guardar corrección' }).click();
  await main.getByText('Corregida por Guille Admin').waitFor();
  ok('Lecturas: corrección queda registrada (quién y cuándo)',
    psql("select lectura_actual||'/'||(corregida_por is not null)||'/'||(select count(*) from lecturas_correcciones) from lecturas where id='11111111-0000-0000-0000-000000000002'") === '3150.000/true/1');

  const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar a Excel' }).click()]);
  const libro = XLSX.readFile(await descarga.path());
  const filas = XLSX.utils.sheet_to_json(libro.Sheets.Lecturas);
  const pend = XLSX.utils.sheet_to_json(libro.Sheets.Pendientes);
  ok('Exportar a Excel: hoja Lecturas y hoja Pendientes', descarga.suggestedFilename() === 'lecturas_octubre_2026.xlsx' && filas.length === 5 && pend.length === 8 && filas.some((f) => f['Corregida por'] === 'Guille Admin'), `${filas.length} lecturas, ${pend.length} pendientes`);

  await main.getByRole('button', { name: 'pendientes' }).click();
  await main.getByText('8 cuentas sin leer').waitFor(); ok('Lecturas: vista de pendientes', true);

  await main.getByRole('button', { name: 'conflictos' }).click();
  await main.getByText('Otro operador ya había leído la cuenta').waitFor();
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase3-conflictos.png` });
  await main.getByRole('button', { name: 'Usar esta lectura' }).click();
  await main.getByText('Conflicto de la cuenta 10001 resuelto.').waitFor();
  ok('Conflictos: reemplazar por la lectura en conflicto', psql(`select lectura_actual from lecturas where cuenta_id='${cta('10001')}'`) === '15270.000');
});

await intentar('Operadores', async () => {
  await page.getByRole('link', { name: 'Operadores' }).click();
  await main.getByText('Juan Pérez').waitFor();
  const filaJuan = main.locator('tr', { hasText: 'Juan Pérez' });
  ok('Operadores: cantidad de lecturas por operador', (await filaJuan.locator('td').nth(3).textContent()).trim() === '3', await filaJuan.locator('td').nth(3).textContent());
  await page.getByRole('button', { name: 'Nuevo operador' }).click();
  const d = page.locator('dialog[open]');
  await d.getByLabel('Nombre y apellido').fill('Carla Ruiz'); await d.getByRole('textbox', { name: 'Nombre de usuario' }).fill('cruiz');
  await d.getByLabel('Contraseña inicial').fill('clave123'); await d.getByRole('button', { name: 'Crear' }).click();
  await main.getByText('Carla Ruiz fue creado').waitFor();
  ok('Operadores: crear (con nombre de usuario)', psql("select nombre||'/'||rol||'/'||usuario from perfiles where email='cruiz@usuarios.lecturas.app'") === 'Carla Ruiz/operador/cruiz');
  await main.locator('tr', { hasText: 'Carla Ruiz' }).getByRole('button', { name: 'Desactivar' }).click();
  await main.getByText('Operador desactivado.').waitFor();
  await main.locator('tr', { hasText: 'Carla Ruiz' }).getByText('Desactivado').waitFor();
  ok('Operadores: desactivar', psql("select activo from perfiles where email='cruiz@usuarios.lecturas.app'") === 'f');
  await main.locator('tr', { hasText: 'Juan Pérez' }).getByRole('button', { name: 'Resetear contraseña' }).click();
  await d.getByLabel('Nueva contraseña').fill('nueva123'); await d.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await main.getByText('Se cambió la contraseña').waitFor(); ok('Operadores: resetear contraseña', true);
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase3-operadores.png` });
});

await intentar('Períodos', async () => {
  await page.getByRole('link', { name: 'Períodos' }).click();
  await main.getByText('Período abierto').waitFor();
  ok('Períodos: no deja abrir otro con uno activo', await page.getByRole('button', { name: 'Abrir nuevo período' }).isDisabled());
  await main.getByRole('button', { name: 'Cerrar período' }).click();
  const d = page.locator('dialog[open]');
  await d.getByText('Pendientes (sin visitar)').waitFor();
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase3-cerrar-periodo.png` });
  ok('Cerrar: botón bloqueado hasta confirmar', await d.getByRole('button', { name: 'Cerrar período' }).isDisabled());
  await d.getByLabel('Revisé el resumen').check(); await d.getByRole('button', { name: 'Cerrar período' }).click();
  await main.getByText(/Período Octubre 2026 cerrado. Se actualizó la última lectura de 4 cuentas/).waitFor();
  ok('Cerrar: actualiza las cuentas', psql("select string_agg(numero_cuenta||'='||ultima_lectura||'/'||coalesce(ultimo_consumo::text,'-'), ' ' order by numero_cuenta) from cuentas where numero_cuenta in ('10001','10004','10010','10003')") === '10001=15270.000/40.000 10003=22105.000/41.000 10004=3150.000/30.000 10010=120.000/-');
  await page.getByRole('button', { name: 'Abrir nuevo período' }).click();
  await d.getByLabel('Nombre').fill('Noviembre 2026'); await d.getByRole('button', { name: 'Abrir período' }).click();
  await main.getByText('Se abrió el período Noviembre 2026').waitFor();
  ok('Abrir nuevo período', psql('select nombre from periodos where activo') === 'Noviembre 2026');
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.log(resultados.join('\n'));
await browser.close();
process.exit(resultados.some((r) => r.startsWith('✗')) ? 1 : 0);
