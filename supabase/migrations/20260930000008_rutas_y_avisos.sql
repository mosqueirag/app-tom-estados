-- =====================================================================
-- 08 · Rutas, asignación de cuentas a operadores y avisos push
--   * cuentas.ruta: agrupa las cuentas (ej. "Ruta 1").
--   * cuentas.operador_id: operador asignado. Un operador ve solo sus
--     cuentas y las que no tienen operador asignado.
--   * v_rutas: resumen por ruta para la pantalla del admin.
--   * suscripciones_push: celulares donde cada usuario activó los avisos.
--   * configuracion_push: claves VAPID. Solo la lee la Edge Function
--     asignar-cuentas (con service_role); nadie más tiene acceso.
-- =====================================================================

alter table public.cuentas add column ruta text not null default '';
alter table public.cuentas add column operador_id uuid references public.perfiles (id) on delete set null;

create index cuentas_ruta_idx     on public.cuentas (ruta);
create index cuentas_operador_idx on public.cuentas (operador_id);

drop policy cuentas_operador_ver_activas on public.cuentas;
create policy cuentas_operador_ver_activas on public.cuentas
  for select to authenticated
  using (
    activa
    and public.es_operador_activo()
    and (operador_id is null or operador_id = auth.uid())
  );

-- ---------------------------------------------------------------------
-- v_lecturas: se agrega la ruta (al final, para no romper la vista)
-- ---------------------------------------------------------------------
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
  l.sin_lectura                                                  as alerta_sin_lectura,
  c.ruta
from public.lecturas l
join public.cuentas  c   on c.id = l.cuenta_id
join public.periodos p   on p.id = l.periodo_id
left join public.perfiles op  on op.id = l.operador_id
left join public.perfiles cor on cor.id = l.corregida_por
cross join public.configuracion cfg;

-- ---------------------------------------------------------------------
-- v_rutas: una fila por ruta (solo cuentas activas)
--   operador_id / operador_nombre: si toda la ruta tiene el mismo operador
--   asignado; si está repartida o sin asignar, quedan en null.
-- ---------------------------------------------------------------------
create or replace view public.v_rutas
with (security_invoker = true) as
with por_ruta as (
  select
    c.ruta,
    count(*)                                             as cuentas,
    count(*) filter (where c.operador_id is null)        as sin_asignar,
    count(distinct c.operador_id)                        as operadores,
    min(c.operador_id::text)                             as un_operador,
    count(*) filter (where not exists (
      select 1 from public.lecturas l
      join public.periodos p on p.id = l.periodo_id and p.activo
      where l.cuenta_id = c.id))                         as pendientes
  from public.cuentas c
  where c.activa
  group by c.ruta
)
select
  r.ruta,
  r.cuentas,
  r.sin_asignar,
  r.pendientes,
  case when r.sin_asignar = 0 and r.operadores = 1 then r.un_operador::uuid end as operador_id,
  case when r.sin_asignar = 0 and r.operadores = 1 then op.nombre end            as operador_nombre,
  (r.sin_asignar > 0 and r.sin_asignar < r.cuentas) or r.operadores > 1          as repartida
from por_ruta r
left join public.perfiles op on op.id = r.un_operador::uuid;

revoke all on public.v_rutas from anon;
grant select on public.v_rutas to authenticated;

-- ---------------------------------------------------------------------
-- Suscripciones a avisos push (una por celular)
-- ---------------------------------------------------------------------
create table public.suscripciones_push (
  id          bigint generated always as identity primary key,
  perfil_id   uuid not null references public.perfiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index suscripciones_push_perfil_idx on public.suscripciones_push (perfil_id);

alter table public.suscripciones_push enable row level security;
revoke all on public.suscripciones_push from anon;
grant select, delete on public.suscripciones_push to authenticated;

create policy suscripciones_ver_propias on public.suscripciones_push
  for select to authenticated
  using (perfil_id = auth.uid() or public.es_admin());

create policy suscripciones_borrar_propias on public.suscripciones_push
  for delete to authenticated
  using (perfil_id = auth.uid());

-- Registrar el celular actual para el usuario actual. Si ese celular estaba
-- registrado a nombre de otro usuario (se cambió de sesión), pasa a este.
create or replace function public.registrar_suscripcion_push(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.es_operador_activo() then
    raise exception 'Tenés que iniciar sesión.' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Suscripción inválida.' using errcode = '22023';
  end if;

  insert into public.suscripciones_push (perfil_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set perfil_id = excluded.perfil_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        created_at = now();
end;
$$;

revoke execute on function public.registrar_suscripcion_push(text, text, text, text) from public, anon;
grant execute on function public.registrar_suscripcion_push(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Claves VAPID para enviar los avisos (solo service_role)
-- ---------------------------------------------------------------------
create table public.configuracion_push (
  id             int primary key default 1 check (id = 1),
  vapid_publica  text not null,
  vapid_privada  text not null,
  contacto       text not null
);

alter table public.configuracion_push enable row level security;
revoke all on public.configuracion_push from anon, authenticated;
