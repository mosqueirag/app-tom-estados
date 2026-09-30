-- =====================================================================
-- 03 · Row Level Security (obligatoria en todas las tablas)
--
-- Admin (activo): acceso total.
-- Operador (activo):
--   cuentas    → SELECT de cuentas activas
--   periodos   → SELECT
--   lecturas   → INSERT propias en el período activo; SELECT propias;
--                sin UPDATE ni DELETE
--   perfiles   → SELECT de su propio perfil
-- Usuario con activo = false → no puede operar (ninguna política lo habilita,
-- salvo leer su propio perfil para que la app le muestre el motivo).
-- =====================================================================

alter table public.perfiles              enable row level security;
alter table public.cuentas               enable row level security;
alter table public.periodos              enable row level security;
alter table public.configuracion         enable row level security;
alter table public.lecturas              enable row level security;
alter table public.lecturas_correcciones enable row level security;
alter table public.lecturas_conflictos   enable row level security;

-- El rol anónimo no tiene nada que hacer en estas tablas.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- perfiles
create policy perfiles_admin_todo on public.perfiles
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy perfiles_ver_propio on public.perfiles
  for select to authenticated
  using (id = auth.uid());

-- ----------------------------------------------------------------- cuentas
create policy cuentas_admin_todo on public.cuentas
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy cuentas_operador_ver_activas on public.cuentas
  for select to authenticated
  using (activa and public.es_operador_activo());

-- ---------------------------------------------------------------- periodos
create policy periodos_admin_todo on public.periodos
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy periodos_operador_ver on public.periodos
  for select to authenticated
  using (public.es_operador_activo());

-- ----------------------------------------------------------- configuracion
create policy configuracion_admin_todo on public.configuracion
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy configuracion_operador_ver on public.configuracion
  for select to authenticated
  using (public.es_operador_activo());

-- ---------------------------------------------------------------- lecturas
create policy lecturas_admin_todo on public.lecturas
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy lecturas_operador_insertar on public.lecturas
  for insert to authenticated
  with check (
    operador_id = auth.uid()
    and public.es_operador_activo()
    and exists (select 1 from public.periodos p where p.id = periodo_id and p.activo)
    and exists (select 1 from public.cuentas c where c.id = cuenta_id and c.activa)
  );

create policy lecturas_operador_ver_propias on public.lecturas
  for select to authenticated
  using (operador_id = auth.uid() and public.es_operador_activo());

-- (sin políticas de UPDATE/DELETE para operadores)

-- --------------------------------------------------- lecturas_correcciones
create policy correcciones_admin_ver on public.lecturas_correcciones
  for select to authenticated
  using (public.es_admin());
-- Las filas las inserta el trigger (security definer); nadie las edita.

-- ----------------------------------------------------- lecturas_conflictos
create policy conflictos_admin_todo on public.lecturas_conflictos
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

create policy conflictos_operador_insertar on public.lecturas_conflictos
  for insert to authenticated
  with check (
    operador_id = auth.uid()
    and public.es_operador_activo()
    and not resuelto
  );

create policy conflictos_operador_ver_propios on public.lecturas_conflictos
  for select to authenticated
  using (operador_id = auth.uid() and public.es_operador_activo());

-- =====================================================================
-- Vista para el admin: lecturas con datos de cuenta, operador y alertas.
-- security_invoker = true → respeta la RLS de quien consulta.
-- =====================================================================
create or replace view public.v_lecturas
with (security_invoker = true) as
select
  l.id,
  l.periodo_id,
  p.nombre                 as periodo_nombre,
  l.cuenta_id,
  c.numero_cuenta,
  c.titular,
  c.direccion,
  c.medidor,
  l.operador_id,
  op.nombre                as operador_nombre,
  l.lectura_anterior,
  l.lectura_actual,
  l.consumo,
  c.ultimo_consumo,
  l.observacion,
  l.sin_lectura,
  l.fecha_lectura,
  l.sincronizado_at,
  l.corregida_por,
  cor.nombre               as corregida_por_nombre,
  l.corregida_at,
  (not l.sin_lectura and l.consumo < 0)                          as alerta_menor_anterior,
  (not l.sin_lectura and l.consumo is not null
     and c.ultimo_consumo is not null and c.ultimo_consumo > 0
     and l.consumo > c.ultimo_consumo * cfg.umbral_consumo_anomalo) as alerta_consumo_anomalo,
  l.sin_lectura                                                  as alerta_sin_lectura
from public.lecturas l
join public.cuentas  c   on c.id = l.cuenta_id
join public.periodos p   on p.id = l.periodo_id
left join public.perfiles op  on op.id = l.operador_id
left join public.perfiles cor on cor.id = l.corregida_por
cross join public.configuracion cfg;

revoke all on public.v_lecturas from anon;

-- Permisos de tabla para usuarios autenticados (la RLS decide las filas)
grant select, insert, update, delete on public.perfiles, public.cuentas, public.periodos,
  public.configuracion, public.lecturas, public.lecturas_conflictos to authenticated;
grant select on public.lecturas_correcciones, public.v_lecturas to authenticated;
