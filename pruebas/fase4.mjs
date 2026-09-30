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
const intentar = async (n, fn) => { try { await fn(); } catch (e) { if (process.env.DEPURAR) console.log('ERR', e.message.slice(0, 1800)); ok(n, false, e.message.split('\n')[0]); console.log('DBG', page.url(), (await page.locator('main').textContent()).slice(0, 500)); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', hasTouch: true, isMobile: true });
await ctx.route('http://supabase.test/**', mock);
const page = await ctx.newPage();
const errores = []; page.on('pageerror', (e) => errores.push(e.message));
const dialogos = []; page.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
const main = page.locator('main');
const estado = page.locator('header [role=status]');
const nLect = () => psql("select count(*) from lecturas where operador_id='bbbbbbbb-0000-0000-0000-000000000002'");

async function cargar(numero, valor, { sinLectura = false, obs = null } = {}) {
  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  await main.getByLabel('Buscar cuenta').fill(numero);
  await main.locator('a', { hasText: numero }).first().click();
  if (sinLectura) await main.getByText('No se pudo leer').click();
  else await main.getByRole('textbox').first().fill(valor);
  if (obs) await main.getByRole('button', { name: obs }).click();
  await main.getByRole('button', { name: 'Continuar' }).click();
  await main.getByText('Confirmar lectura').first().waitFor();
}

await page.goto(BASE + '/login');
await page.getByLabel('Email o usuario').fill('jperez'); await page.getByLabel('Contraseña').fill('secreto');
await page.getByRole('button', { name: 'Ingresar' }).click(); await page.waitForURL(BASE + '/operador');

await intentar('Descargar', async () => {
  await main.getByText('Sin descargar').waitFor();
  await main.getByRole('button', { name: 'Descargar cuentas' }).click();
  await main.getByText('Listo: 10 cuentas guardadas en el celular para Octubre 2026.').waitFor();
  ok('Descargar cuentas y período', true);
  ok('Indicador visible "En línea · todo enviado"', (await estado.textContent()) === 'En línea · todo enviado');
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase4-inicio.png`, fullPage: true });
});

await intentar('Buscar', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  await main.getByLabel('Buscar cuenta').fill('garcia');
  ok('Buscar sin acentos por titular', (await main.locator('li a').count()) === 1);
  await main.getByLabel('Buscar cuenta').fill('MED-458727');
  ok('Buscar por medidor', (await main.locator('li a').first().textContent()).includes('10007'));
  await main.getByLabel('Buscar cuenta').fill('mitre 312');
  ok('Buscar por dirección', (await main.locator('li a').first().textContent()).includes('10003'));
});

await intentar('Lectura online', async () => {
  await cargar('10001', '15262,5');
  const t = await main.textContent();
  ok('Confirmar muestra anterior, actual y consumo', t.includes('15.230') && t.includes('15.262,5') && t.includes('32,5'));
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase4-confirmar.png` });
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10001 guardada.').waitFor();
  await page.waitForFunction(() => document.querySelector('header [role=status]')?.textContent === 'En línea · todo enviado');
  ok('Con señal se envía sola', psql("select lectura_actual||'/'||lectura_anterior from lecturas where id in (select id from lecturas where operador_id='bbbbbbbb-0000-0000-0000-000000000002')") === '15262.500/15230.000');
});

await intentar('Offline', async () => {
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await cargar('10004', '3300');
  ok('Consumo anómalo pide confirmación', (await main.textContent()).includes('Consumo muy alto') && await main.getByRole('button', { name: 'Confirmar lectura' }).isDisabled());
  await main.getByText('Revisé el medidor y el número es correcto').click();
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10004 guardada.').waitFor();

  await cargar('10010', '120');
  ok('Lectura menor: "¿Vuelta de medidor o error?"', (await main.textContent()).includes('¿Vuelta de medidor o error?') && await main.getByRole('button', { name: 'Confirmar lectura' }).isDisabled());
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase4-vuelta-medidor.png` });
  await main.getByText('Revisé el medidor y el número es correcto').click();
  const antes = dialogos.length;
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10010 guardada.').waitFor();
  ok('Lectura menor: segunda confirmación', dialogos.length === antes + 1 && dialogos.at(-1).includes('MENOR'));

  await cargar('10003', '', { sinLectura: true, obs: 'Perro' });
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10003 guardada.').waitFor();

  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  await main.getByLabel('Buscar cuenta').fill('');
  ok('Indicador "Sin conexión · 3 lecturas pendientes"', (await estado.textContent()) === 'Sin conexión · 3 lecturas pendientes', await estado.textContent());
  ok('Sin señal no llega nada al servidor', nLect() === '1');
  await main.getByRole('button', { name: /Leídas/ }).click();
  ok('Filtro leídas', (await main.locator('li a').count()) === 4);
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase4-sin-conexion.png` });

  await main.locator('li a', { hasText: '10001' }).click();
  await main.getByText('Esta cuenta ya fue leída en este período desde este celular.').waitFor();
  ok('No deja duplicar una cuenta ya enviada', await main.getByRole('button', { name: 'Continuar' }).count() === 0);
  await page.getByRole('navigation').getByRole('link', { name: 'Buscar' }).click();
  await main.getByRole('button', { name: /Leídas/ }).click();
  await main.locator('li a', { hasText: '10004' }).click();
  await main.getByText('podés corregirla').waitFor();
  await main.getByRole('textbox').first().fill('3200');
  await main.getByRole('button', { name: 'Continuar' }).click();
  await main.getByText('Revisé el medidor y el número es correcto').click();
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10004 guardada.').waitFor();
  ok('Pendiente sin enviar se puede corregir sin duplicar', (await estado.textContent()) === 'Sin conexión · 3 lecturas pendientes');
});

await intentar('Vuelve la señal', async () => {
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('header [role=status]')?.textContent === 'En línea · todo enviado', null, { timeout: 15000 });
  ok('Al volver la señal se sincroniza solo', nLect() === '4');
  ok('Datos en el servidor', psql("select string_agg(c.numero_cuenta||'='||coalesce(l.lectura_actual::text,'SL:'||l.observacion), ' ' order by c.numero_cuenta) from lecturas l join cuentas c on c.id=l.cuenta_id where l.operador_id='bbbbbbbb-0000-0000-0000-000000000002'") === '10001=15262.500 10003=SL:Perro 10004=3200.000 10010=120.000', psql("select string_agg(c.numero_cuenta||'='||coalesce(l.lectura_actual::text,'SL:'||l.observacion), ' ' order by c.numero_cuenta) from lecturas l join cuentas c on c.id=l.cuenta_id where l.operador_id='bbbbbbbb-0000-0000-0000-000000000002'"));
});

await intentar('Idempotencia', async () => {
  // Simula que el celular no recibió la respuesta: vuelve a marcar todo como pendiente y reenvía.
  await page.evaluate(() => new Promise((ok, mal) => {
    const r = indexedDB.open('lecturas-medidores');
    r.onsuccess = () => {
      const tx = r.result.transaction('lecturas', 'readwrite'); const st = tx.objectStore('lecturas');
      st.getAll().onsuccess = (e) => { for (const l of e.target.result) st.put({ ...l, estado: 'pendiente' }); };
      tx.oncomplete = () => ok(); tx.onerror = mal;
    };
  }));
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click();
  await main.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await main.getByText('Enviadas: 4.').waitFor();
  ok('Reintentar no duplica (upsert por id)', nLect() === '4');
});

await intentar('Conflicto', async () => {
  const per = psql('select id from periodos where activo');
  await rpcOperador('mgomez@usuarios.lecturas.app', [{ id: '22222222-0000-0000-0000-000000000009', cuenta_id: psql("select id from cuentas where numero_cuenta='10005'"), periodo_id: per, lectura_actual: 12000, fecha_lectura: new Date().toISOString() }]);
  await cargar('10005', '11999');
  await main.getByRole('button', { name: 'Confirmar lectura' }).click();
  await main.getByText('Lectura de la cuenta 10005 guardada.').waitFor();
  await page.getByRole('navigation').getByRole('link', { name: 'Inicio' }).click();
  await main.getByText('1 con conflicto: ver').waitFor();
  await main.getByText('1 con conflicto: ver').click();
  await main.getByText('Esta cuenta ya fue leída en este período por otro operador.').waitFor();
  ok('Conflicto visible para el operador sin perder el dato', psql("select lectura_actual from lecturas_conflictos where cuenta_id=(select id from cuentas where numero_cuenta='10005')") === '11999.000');
  if (CAPT) await page.screenshot({ path: `${CAPT}/fase4-mis-lecturas.png` });
});

ok('Sin errores de JavaScript', errores.length === 0, errores.join(' | '));
console.log(resultados.join('\n'));
await browser.close();
process.exit(resultados.some((r) => r.startsWith('✗')) ? 1 : 0);
