-- =====================================================================
-- Borra los datos de PRUEBA que cargó cargar.sql (y las cuentas 10031 a
-- 10040 si importaste el Excel de prueba). No toca tu usuario admin.
-- =====================================================================
begin;
delete from public.lecturas_correcciones where lectura_id in (
  select l.id from public.lecturas l join public.cuentas c on c.id = l.cuenta_id
  where c.numero_cuenta between '10001' and '10040');
delete from public.lecturas_conflictos where cuenta_id in (
  select id from public.cuentas where numero_cuenta between '10001' and '10040');
delete from public.lecturas where cuenta_id in (
  select id from public.cuentas where numero_cuenta between '10001' and '10040');
delete from public.periodos p where p.nombre = 'Septiembre 2026'
  and not exists (select 1 from public.lecturas l where l.periodo_id = p.id)
  and not exists (select 1 from public.lecturas_conflictos x where x.periodo_id = p.id);
delete from public.cuentas where numero_cuenta between '10001' and '10040';
delete from auth.users where email in ('jperez@usuarios.lecturas.app', 'mgomez@usuarios.lecturas.app');
commit;
