-- Prueba de RLS, sincronización, conflictos y cierre de período.
-- Correr en un Postgres LOCAL después de 00_simular_supabase.sql, las migraciones y seed.sql.
\set ON_ERROR_STOP 0
\pset footer off
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','admin@x.com','{"nombre":"Admin","rol":"admin"}'),
 ('00000000-0000-0000-0000-000000000001','op1@x.com','{"nombre":"Operador Uno"}'),
 ('00000000-0000-0000-0000-000000000002','op2@x.com','{"nombre":"Operador Dos","usuario":"op2"}'),
 ('00000000-0000-0000-0000-000000000003','op3@x.com','{}');
select nombre, usuario, rol, activo from perfiles order by email;
update perfiles set activo=true; -- los perfiles nacen desactivados (migración 06)
update perfiles set rol='admin' where email='admin@x.com';
update perfiles set activo=false where email='op3@x.com';
update cuentas set activa=false where numero_cuenta='10009';

\echo '--- op1: cuentas visibles (esperado 9), perfiles (1), configuracion (1)'
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select (select count(*) from cuentas) cuentas, (select count(*) from perfiles) perfiles, (select count(*) from configuracion) cfg, (select count(*) from periodos) periodos;
\echo '--- op1 intenta update/insert cuentas y cambiarse el rol (esperado 0 filas / error)'
update cuentas set titular='x'; insert into cuentas(numero_cuenta) values ('999'); update perfiles set rol='admin';
\echo '--- op1 sincroniza 3 lecturas (10001 ok, 10004 anomala, 10010 vuelta), + 1 negativa, + 1 sin lectura con valor'
select * from sincronizar_lecturas((select jsonb_agg(x) from (
  select jsonb_build_object('id','11111111-0000-0000-0000-000000000001','cuenta_id',(select id from cuentas where numero_cuenta='10001'),'periodo_id',(select id from periodos where activo),'lectura_actual',15262.5,'fecha_lectura','2026-10-05T10:00:00-03:00') x
  union all select jsonb_build_object('id','11111111-0000-0000-0000-000000000002','cuenta_id',(select id from cuentas where numero_cuenta='10004'),'periodo_id',(select id from periodos where activo),'lectura_actual',3220,'fecha_lectura','2026-10-05T23:30:00-03:00')
  union all select jsonb_build_object('id','11111111-0000-0000-0000-000000000003','cuenta_id',(select id from cuentas where numero_cuenta='10010'),'periodo_id',(select id from periodos where activo),'lectura_actual',120,'fecha_lectura','2026-10-05T10:00:00-03:00')
  union all select jsonb_build_object('id','11111111-0000-0000-0000-000000000004','cuenta_id',(select id from cuentas where numero_cuenta='10002'),'periodo_id',(select id from periodos where activo),'lectura_actual',-5)
  union all select jsonb_build_object('id','11111111-0000-0000-0000-000000000005','cuenta_id',(select id from cuentas where numero_cuenta='10003'),'periodo_id',(select id from periodos where activo),'lectura_actual',999,'sin_lectura',true,'observacion','perro')
  union all select jsonb_build_object('id','11111111-0000-0000-0000-000000000006','cuenta_id',(select id from cuentas where numero_cuenta='10005'),'periodo_id',(select id from periodos where activo),'lectura_actual','abc')
) s));
\echo '--- reintento del mismo lote (esperado sincronizada, sin duplicar)'
select * from sincronizar_lecturas(jsonb_build_array(jsonb_build_object('id','11111111-0000-0000-0000-000000000001','cuenta_id',(select id from cuentas where numero_cuenta='10001'),'periodo_id',(select id from periodos where activo),'lectura_actual',15262.5)));
select numero_cuenta, lectura_anterior, lectura_actual, consumo, sin_lectura, observacion from lecturas join cuentas c on c.id=cuenta_id order by 1;
\echo '--- op1 update/delete lecturas (esperado 0), insert directo como otro operador (esperado error RLS)'
update lecturas set lectura_actual=1; delete from lecturas;
insert into lecturas(id,cuenta_id,periodo_id,operador_id,lectura_actual,fecha_lectura) values (gen_random_uuid(),(select id from cuentas where numero_cuenta='10006'),(select id from periodos where activo),'00000000-0000-0000-0000-000000000002',600,now());
\echo '--- op1 insert directo propio con lectura_anterior falsa (esperado anterior=560 del servidor)'
insert into lecturas(id,cuenta_id,periodo_id,operador_id,lectura_anterior,lectura_actual,fecha_lectura) values ('11111111-0000-0000-0000-000000000007',(select id from cuentas where numero_cuenta='10006'),(select id from periodos where activo),'00000000-0000-0000-0000-000000000001',0,570,now()) returning lectura_anterior, consumo;
\echo '--- op1 cuenta inactiva 10009 (no la ve -> FK/RLS rechazada)'
select * from sincronizar_lecturas(jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'cuenta_id',(select id from cuentas where numero_cuenta='10009' union all select '00000000-0000-0000-0000-0000000000ff' limit 1),'periodo_id',(select id from periodos where activo),'lectura_actual',5)));
\echo '--- op1 cerrar_periodo / abrir_periodo (esperado error)'
select cerrar_periodo((select id from periodos where activo));
select abrir_periodo('x');

\echo '--- op2 lee la misma cuenta 10001 (esperado conflicto)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select * from sincronizar_lecturas(jsonb_build_array(jsonb_build_object('id','22222222-0000-0000-0000-000000000001','cuenta_id',(select id from cuentas where numero_cuenta='10001'),'periodo_id',(select id from periodos where activo),'lectura_actual',15270,'fecha_lectura','2026-10-06T09:00:00-03:00')));
select * from sincronizar_lecturas(jsonb_build_array(jsonb_build_object('id','22222222-0000-0000-0000-000000000001','cuenta_id',(select id from cuentas where numero_cuenta='10001'),'periodo_id',(select id from periodos where activo),'lectura_actual',15270)));
select count(*) as op2_ve_lecturas from lecturas; select motivo, lectura_actual from lecturas_conflictos;

\echo '--- op3 inactivo (esperado 0 cuentas y error al sincronizar)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select (select count(*) from cuentas) cuentas, (select count(*) from perfiles) perfiles;
select * from sincronizar_lecturas('[]');

\echo '--- admin'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select count(*) cuentas_admin from cuentas;
select numero_cuenta, operador_nombre, consumo, alerta_menor_anterior, alerta_consumo_anomalo, alerta_sin_lectura from v_lecturas order by 1;
\echo '--- admin corrige 10001'
update lecturas set lectura_actual=15261, observacion='corregida' where id='11111111-0000-0000-0000-000000000001' returning consumo, corregida_por is not null as corregida, corregida_at is not null;
select lectura_actual_anterior, lectura_actual_nueva from lecturas_correcciones;
\echo '--- admin intenta cambiar operador (esperado error)'
update lecturas set operador_id='00000000-0000-0000-0000-000000000002' where id='11111111-0000-0000-0000-000000000001';
\echo '--- admin se quita el rol (esperado error)'
update perfiles set rol='operador' where id=auth.uid();
select resumen_periodo((select id from periodos where activo));
\echo '--- resolver conflicto reemplazando'
select resolver_conflicto('22222222-0000-0000-0000-000000000001','reemplazar');
select c.numero_cuenta, p.nombre, l.lectura_actual from lecturas l join cuentas c on c.id=l.cuenta_id join perfiles p on p.id=l.operador_id where c.numero_cuenta='10001';
select id, motivo, resuelto, resolucion from lecturas_conflictos order by created_at;
\echo '--- abrir otro periodo con uno activo (esperado error)'
select abrir_periodo('Noviembre 2026');
\echo '--- cerrar'
select cerrar_periodo((select id from periodos where activo));
select numero_cuenta, ultima_lectura, fecha_ultima_lectura, ultimo_consumo from cuentas order by 1;
select nombre, activo, fecha_cierre, cerrado_por is not null from periodos;
select cerrar_periodo((select id from periodos limit 1));
\echo '--- correccion en periodo cerrado (esperado error)'
update lecturas set lectura_actual=1 where id='11111111-0000-0000-0000-000000000002';

\echo '--- op1 sincroniza tarde en periodo cerrado (esperado conflicto periodo_cerrado)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select * from sincronizar_lecturas(jsonb_build_array(jsonb_build_object('id','11111111-0000-0000-0000-000000000009','cuenta_id',(select id from cuentas where numero_cuenta='10007'),'periodo_id',(select id from periodos limit 1),'lectura_actual',45100)));
\echo '--- admin abre nuevo periodo'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select nombre, activo, fecha_inicio from abrir_periodo('Noviembre 2026');
\echo '--- anon'
reset role; set role anon;
select count(*) from cuentas;
select * from sincronizar_lecturas('[]');
