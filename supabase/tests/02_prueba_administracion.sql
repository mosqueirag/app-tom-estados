-- Prueba de la migración 05 (correr después de 01_prueba_rls_y_cierre.sql).
\pset footer off
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
\echo '--- hay período activo (Noviembre): cambiar ultima_lectura (esperado error), titular (ok)'
update cuentas set ultima_lectura = 1 where numero_cuenta = '10002';
update cuentas set titular = 'Fernández, Juan C.' where numero_cuenta = '10002';
\echo '--- insertar cuenta nueva con ultima_lectura durante período activo (ok)'
insert into cuentas (numero_cuenta, titular, direccion, medidor, ultima_lectura) values ('10011','Nueva','Calle 1','M-1', 50);
\echo '--- v_operadores'
select nombre, rol, activo, lecturas_periodo_activo, lecturas_total, conflictos_pendientes from v_operadores order by nombre;
\echo '--- v_conflictos'
select numero_cuenta, operador_nombre, motivo, lectura_actual, existente_lectura_actual, existente_operador_nombre, resuelto from v_conflictos order by created_at;
\echo '--- cuentas_pendientes del período activo (esperado 10: 9 activas + la nueva)'
select count(*) from cuentas_pendientes((select id from periodos where activo));
\echo '--- operador: vistas y pendientes (esperado 0 filas en v_operadores salvo él, 0 pendientes)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select count(*) as v_operadores from v_operadores; select count(*) as pendientes from cuentas_pendientes((select id from periodos where activo));
\echo '--- admin carga lectura y cierra noviembre: cuenta se actualiza con período cerrado'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select estado from sincronizar_lecturas(jsonb_build_array(jsonb_build_object('id','33333333-0000-0000-0000-000000000001','cuenta_id',(select id from cuentas where numero_cuenta='10002'),'periodo_id',(select id from periodos where activo),'lectura_actual',8770)));
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select cerrar_periodo((select id from periodos where activo)) ->> 'cuentas_actualizadas' as actualizadas;
select numero_cuenta, ultima_lectura, ultimo_consumo from cuentas where numero_cuenta = '10002';
\echo '--- sin período activo: cambiar ultima_lectura (ok)'
update cuentas set ultima_lectura = 8800 where numero_cuenta = '10002' returning ultima_lectura;
