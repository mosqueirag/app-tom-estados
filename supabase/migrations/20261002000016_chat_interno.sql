-- =====================================================================
-- 16 · Chat interno entre el admin y cada operador
--   * Cada operador tiene su conversación: los mensajes con para_id = su id.
--     Los escribe el admin (autor = admin) o el mismo operador (autor = él).
--     para_id null sigue siendo "para todos" (se ve en todas las conversaciones).
--   * leido_at: cuándo lo leyó quien lo recibió (el operador o el admin).
--   * Realtime: los mensajes llegan al instante (respeta la RLS).
-- =====================================================================

alter table public.mensajes add column leido_at timestamptz;

-- El operador escribe solo en su propia conversación y a su nombre
create policy mensajes_operador_escribir on public.mensajes
  for insert to authenticated
  with check (
    public.es_operador_activo()
    and autor_id = (select auth.uid())
    and para_id = (select auth.uid())
    and leido_at is null
  );

-- Marca como leídos los mensajes recibidos en una conversación.
--   admin:    los que escribió el operador p_operador
--   operador: los que le escribió el admin (p_operador se ignora)
create or replace function public.marcar_mensajes_leidos(p_operador uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_yo uuid := (select auth.uid());
  v_n integer;
begin
  if public.es_admin() then
    update public.mensajes set leido_at = now()
    where para_id = p_operador and autor_id = p_operador and leido_at is null;
  elsif public.es_operador_activo() then
    update public.mensajes set leido_at = now()
    where para_id = v_yo and autor_id is distinct from v_yo and leido_at is null;
  else
    raise exception 'Sin permiso.' using errcode = '42501';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.marcar_mensajes_leidos(uuid) from public, anon;
grant execute on function public.marcar_mensajes_leidos(uuid) to authenticated;

-- Lista de conversaciones para el admin: último mensaje y cuántos sin leer
create or replace view public.v_conversaciones
with (security_invoker = true) as
select
  p.id                                   as operador_id,
  p.nombre,
  p.activo,
  u.texto                                as ultimo_texto,
  u.created_at                           as ultimo_at,
  coalesce(u.autor_id = p.id, false)     as ultimo_del_operador,
  (select count(*) from public.mensajes x
    where x.para_id = p.id and x.autor_id = p.id and x.leido_at is null)::int as sin_leer
from public.perfiles p
left join lateral (
  select m.texto, m.created_at, m.autor_id
  from public.mensajes m
  where m.para_id = p.id
  order by m.created_at desc
  limit 1
) u on true
where p.rol = 'operador';
revoke all on public.v_conversaciones from anon;
grant select on public.v_conversaciones to authenticated;

create index mensajes_sin_leer_idx on public.mensajes (para_id) where leido_at is null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensajes') then
      alter publication supabase_realtime add table public.mensajes;
    end if;
  end if;
end;
$$;
