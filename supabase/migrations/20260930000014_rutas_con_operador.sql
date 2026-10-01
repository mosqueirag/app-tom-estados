-- =====================================================================
-- Rutas con operador fijo
--   * rutas: lista de rutas (vienen cargadas de "Ruta 1" a "Ruta 20") y el
--     operador que lee cada una. Existe aunque la ruta no tenga cuentas.
--   * Al crear una cuenta, o al cambiarle la ruta, la cuenta pasa sola al
--     operador de su ruta.
--   * v_rutas: muestra todas las rutas de la tabla, con o sin cuentas.
-- =====================================================================

create table public.rutas (
  nombre       text primary key check (btrim(nombre) <> '' and nombre = btrim(nombre)),
  operador_id  uuid references public.perfiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index rutas_operador_idx on public.rutas (operador_id);

alter table public.rutas enable row level security;
create policy rutas_admin_todo on public.rutas
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

revoke all on public.rutas from anon;
grant select, insert, update, delete on public.rutas to authenticated;

update public.cuentas set ruta = btrim(ruta) where ruta <> btrim(ruta);

-- Las 20 rutas y las que ya existen en las cuentas
insert into public.rutas (nombre)
select 'Ruta ' || n from generate_series(1, 20) n
on conflict do nothing;

insert into public.rutas (nombre)
select distinct btrim(ruta) from public.cuentas where btrim(ruta) <> ''
on conflict do nothing;

-- Si una ruta entera ya estaba asignada a un operador, se conserva
update public.rutas r
set operador_id = v.operador_id
from public.v_rutas v
where v.ruta = r.nombre and v.operador_id is not null;

-- ---------------------------------------------------------------------
-- La cuenta toma el operador de su ruta
-- ---------------------------------------------------------------------
create or replace function public.cuentas_operador_de_ruta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operador uuid;
begin
  new.ruta := btrim(new.ruta);
  if new.ruta = '' then
    return new;
  end if;

  insert into public.rutas (nombre) values (new.ruta) on conflict do nothing;

  if tg_op = 'INSERT' then
    if new.operador_id is null then
      select r.operador_id into v_operador from public.rutas r where r.nombre = new.ruta;
      new.operador_id := v_operador;
    end if;
  elsif new.ruta is distinct from old.ruta and new.operador_id is not distinct from old.operador_id then
    select r.operador_id into v_operador from public.rutas r where r.nombre = new.ruta;
    new.operador_id := v_operador;
  end if;
  return new;
end;
$$;
revoke execute on function public.cuentas_operador_de_ruta() from public, anon, authenticated;

create trigger cuentas_operador_de_ruta
  before insert or update of ruta on public.cuentas
  for each row execute function public.cuentas_operador_de_ruta();

-- ---------------------------------------------------------------------
-- v_rutas: todas las rutas (con o sin cuentas), ordenadas por número
-- ---------------------------------------------------------------------
drop view public.v_rutas;
create view public.v_rutas
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
),
todas as (
  select
    coalesce(r.nombre, p.ruta)                           as ruta,
    coalesce(p.cuentas, 0)                               as cuentas,
    coalesce(p.sin_asignar, 0)                           as sin_asignar,
    coalesce(p.pendientes, 0)                            as pendientes,
    case
      when r.nombre is not null then r.operador_id
      when p.sin_asignar = 0 and p.operadores = 1 then p.un_operador::uuid
    end                                                  as operador_id,
    case
      when r.nombre is null then (p.sin_asignar > 0 and p.sin_asignar < p.cuentas) or p.operadores > 1
      when coalesce(p.cuentas, 0) = 0 then false
      when r.operador_id is null then p.sin_asignar < p.cuentas
      else p.sin_asignar > 0 or p.operadores > 1 or p.un_operador::uuid <> r.operador_id
    end                                                  as repartida
  from public.rutas r
  full join por_ruta p on p.ruta = r.nombre
)
select
  t.ruta,
  t.cuentas,
  t.sin_asignar,
  t.pendientes,
  t.operador_id,
  op.nombre                                              as operador_nombre,
  t.repartida,
  coalesce(substring(t.ruta from '(\d{1,9})\s*$')::int, 100000) as orden
from todas t
left join public.perfiles op on op.id = t.operador_id;

revoke all on public.v_rutas from anon;
grant select on public.v_rutas to authenticated;
