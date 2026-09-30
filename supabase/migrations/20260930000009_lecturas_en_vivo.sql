-- =====================================================================
-- 09 · Lecturas en vivo y cuentas nuevas asignadas por ruta
--   * El panel del admin recibe las lecturas al instante (Supabase Realtime).
--     Realtime respeta la RLS: cada usuario solo recibe lo que puede leer.
--   * Una cuenta nueva (o que cambia de ruta) queda asignada sola al operador
--     de esa ruta, si la ruta tiene un único operador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Realtime: publicar las lecturas y los conflictos
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lecturas') then
      alter publication supabase_realtime add table public.lecturas;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lecturas_conflictos') then
      alter publication supabase_realtime add table public.lecturas_conflictos;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Operador de una ruta: el único operador que tienen sus cuentas activas.
-- Si la ruta está sin asignar o repartida entre varios, devuelve null.
-- ---------------------------------------------------------------------
create or replace function public.operador_de_ruta(p_ruta text, p_excluir uuid default null)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when count(distinct c.operador_id) = 1
                   and count(*) filter (where c.operador_id is null) = 0
              then (array_agg(c.operador_id))[1] end
  from public.cuentas c
  where c.ruta = p_ruta
    and p_ruta <> ''
    and c.activa
    and c.id is distinct from p_excluir;
$$;

revoke execute on function public.operador_de_ruta(text, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- Al crear una cuenta sin operador, o al moverla de ruta sin tocar el
-- operador, toma el operador de la ruta.
-- ---------------------------------------------------------------------
create or replace function public.cuentas_heredar_operador_de_ruta()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_operador uuid;
begin
  if tg_op = 'INSERT' then
    if new.operador_id is null then
      new.operador_id := public.operador_de_ruta(new.ruta, new.id);
    end if;
  elsif new.ruta is distinct from old.ruta and new.operador_id is not distinct from old.operador_id then
    v_operador := public.operador_de_ruta(new.ruta, new.id);
    if v_operador is not null then
      new.operador_id := v_operador;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.cuentas_heredar_operador_de_ruta() from public, anon, authenticated;

create trigger cuentas_antes_heredar_operador
  before insert or update of ruta on public.cuentas
  for each row execute function public.cuentas_heredar_operador_de_ruta();
