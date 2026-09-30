-- Prueba de la migración 08 (correr después de 02_prueba_administracion.sql).
\pset footer off
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
\echo '--- admin asigna rutas: 10001-10005 Ruta 1 a Operador Uno, 10006-10008 Ruta 2 a Operador Dos, resto sin asignar'
update cuentas set ruta = 'Ruta 1', operador_id = '00000000-0000-0000-0000-000000000001' where numero_cuenta between '10001' and '10005';
update cuentas set ruta = 'Ruta 2', operador_id = '00000000-0000-0000-0000-000000000002' where numero_cuenta between '10006' and '10008';
update cuentas set ruta = 'Ruta 3' where numero_cuenta between '10009' and '10011';
update cuentas set operador_id = '00000000-0000-0000-0000-000000000001' where numero_cuenta = '10009';
\echo '--- v_rutas (solo activas; 10009 quedó dada de baja en la prueba 01, así que Ruta 3 queda toda sin asignar)'
select ruta, cuentas, sin_asignar, operador_nombre, repartida from v_rutas order by ruta;
\echo '--- Operador Uno ve Ruta 1 + las sin asignar de Ruta 3 (esperado 7)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select count(*) as ve_op1 from cuentas;
\echo '--- Operador Dos ve Ruta 2 + sin asignar de Ruta 3 (esperado 5)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select count(*) as ve_op2 from cuentas;
\echo '--- operador registra su celular (ok), otro usuario toma el mismo celular (pasa a él)'
select registrar_suscripcion_push('https://push.ejemplo/abc', 'clave', 'secreto', 'prueba');
select count(*) as mis_suscripciones from suscripciones_push;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select registrar_suscripcion_push('https://push.ejemplo/abc', 'clave2', 'secreto2', 'prueba');
select count(*) as mis_suscripciones_op1 from suscripciones_push;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select count(*) as quedan_op2 from suscripciones_push;
\echo '--- endpoint que no es https (esperado error)'
select registrar_suscripcion_push('http://malo', 'a', 'b');
\echo '--- nadie con sesión puede leer las claves VAPID (esperado error)'
select * from configuracion_push;
\echo '--- operador no puede asignarse cuentas (esperado 0 filas)'
update cuentas set operador_id = '00000000-0000-0000-0000-000000000002' where numero_cuenta = '10010' returning numero_cuenta;
reset role;
