-- =====================================================================
-- Datos de PRUEBA para ver la app funcionando.
-- 30 cuentas (10001 a 10030), período "Septiembre 2026" abierto,
-- 2 operadores (jperez y mgomez, contraseña: prueba123),
-- 20 lecturas variadas, 1 conflicto y 3 rutas. Se borra todo con borrar.sql.
-- =====================================================================

-- Cuentas
insert into public.cuentas (numero_cuenta, titular, direccion, medidor, ultima_lectura, fecha_ultima_lectura, ultimo_consumo)
select '100' || lpad(n::text, 2, '0'),
       (array['García, María Laura','Fernández, Juan Carlos','López, Ana Sofía','Martínez, Roberto','Rodríguez, Claudia',
              'Gómez, Luciano','Díaz, Patricia','Pérez, Sergio Daniel','Sosa, Graciela','Romero, Hugo Alberto',
              'Álvarez, Marcela','Torres, Diego','Ruiz, Silvina','Benítez, Ramón','Acosta, Lorena',
              'Medina, Carlos','Herrera, Julieta','Suárez, Matías','Aguirre, Norma','Giménez, Pablo',
              'Molina, Verónica','Castro, Héctor','Ortiz, Florencia','Silva, Gustavo','Rojas, Beatriz',
              'Núñez, Oscar','Luna, Carolina','Cabrera, Walter','Ríos, Mónica','Vega, Federico'])[n],
       (array['Av. San Martín','Belgrano','Mitre','Rivadavia','Sarmiento','25 de Mayo','Moreno','Urquiza','Pasaje Los Aromos','Ruta 5 Km'])[1 + (n - 1) % 10]
         || ' ' || (100 + n * 37),
       'MED-' || (458700 + n),
       1000 + n * 523,
       date '2026-08-31',
       20 + (n * 7) % 40
from generate_series(1, 30) n
on conflict (numero_cuenta) do nothing;

-- Período abierto
insert into public.periodos (nombre, fecha_inicio, activo)
select 'Septiembre 2026', date '2026-09-01', true
where not exists (select 1 from public.periodos where activo);

-- Operadores de prueba (usuario jperez / mgomez, contraseña prueba123)
with nuevos (email, nombre, usuario) as (
  values ('jperez@usuarios.lecturas.app', 'Juan Pérez', 'jperez'),
         ('mgomez@usuarios.lecturas.app', 'María Gómez', 'mgomez')
), u as (
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    n.email, extensions.crypt('prueba123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', n.nombre, 'usuario', n.usuario),
    now(), now(), '', '', '', ''
  from nuevos n
  where not exists (select 1 from auth.users x where x.email = n.email)
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from u;

update public.perfiles set activo = true
where email in ('jperez@usuarios.lecturas.app', 'mgomez@usuarios.lecturas.app');

-- Lecturas: 10001-10020 leídas; 10021-10030 quedan pendientes
with p as (select id from public.periodos where activo),
     op as (select
              (select id from public.perfiles where usuario = 'jperez') as juan,
              (select id from public.perfiles where usuario = 'mgomez') as maria),
     datos (numero, consumo, sin_lectura, observacion) as (
  values
    ('10001', 28,   false, null),
    ('10002', 35,   false, null),
    ('10003', 22,   false, null),
    ('10004', 41,   false, null),
    ('10005', -120, false, 'El medidor parece cambiado'),      -- menor a la anterior
    ('10006', 30,   false, null),
    ('10007', 190,  false, 'Posible pérdida de agua'),         -- consumo anómalo
    ('10008', 25,   false, null),
    ('10009', null, true,  'Perro suelto, no se pudo entrar'), -- sin lectura
    ('10010', 33,   false, null),
    ('10011', 19,   false, null),
    ('10012', 27,   false, null),
    ('10013', -8,   false, null),                               -- menor a la anterior
    ('10014', 38,   false, null),
    ('10015', 260,  false, null),                               -- consumo anómalo
    ('10016', 24,   false, null),
    ('10017', null, true,  'Medidor tapado con escombros'),     -- sin lectura
    ('10018', 31,   false, null),
    ('10019', 29,   false, null),
    ('10020', 36,   false, 'Casa sin moradores')
)
insert into public.lecturas (id, cuenta_id, periodo_id, operador_id, lectura_actual, observacion, sin_lectura, fecha_lectura)
select gen_random_uuid(), c.id, p.id,
       case when d.numero::int % 2 = 0 then op.maria else op.juan end,
       case when d.sin_lectura then null else c.ultima_lectura + d.consumo end,
       d.observacion, d.sin_lectura,
       timestamp with time zone '2026-09-29 09:00:00-03' + (d.numero::int - 10000) * interval '17 minutes'
from datos d
join public.cuentas c on c.numero_cuenta = d.numero
cross join p cross join op
on conflict (cuenta_id, periodo_id) do nothing;

-- Un conflicto: María volvió a leer la cuenta 10003, que ya había leído Juan
insert into public.lecturas_conflictos (id, cuenta_id, periodo_id, operador_id, lectura_actual, observacion,
  sin_lectura, fecha_lectura, motivo, lectura_existente_id)
select gen_random_uuid(), l.cuenta_id, l.periodo_id, (select id from public.perfiles where usuario = 'mgomez'),
       l.lectura_actual + 5, 'La leí de nuevo por las dudas', false,
       timestamp with time zone '2026-09-29 16:40:00-03', 'ya_leida', l.id
from public.lecturas l
join public.cuentas c on c.id = l.cuenta_id
join public.periodos p on p.id = l.periodo_id and p.activo
where c.numero_cuenta = '10003'
  and not exists (select 1 from public.lecturas_conflictos x where x.cuenta_id = l.cuenta_id and x.periodo_id = l.periodo_id);

-- Rutas: 10001-10010 Ruta 1 (Juan), 10011-10020 Ruta 2 (María), 10021-10030 Ruta 3 sin asignar
update public.cuentas set ruta = 'Ruta 1' where numero_cuenta between '10001' and '10010';
update public.cuentas set ruta = 'Ruta 2' where numero_cuenta between '10011' and '10020';
update public.cuentas set ruta = 'Ruta 3' where numero_cuenta between '10021' and '10030';
update public.cuentas set operador_id = (select id from public.perfiles where usuario = 'jperez') where ruta = 'Ruta 1';
update public.cuentas set operador_id = (select id from public.perfiles where usuario = 'mgomez') where ruta = 'Ruta 2';
