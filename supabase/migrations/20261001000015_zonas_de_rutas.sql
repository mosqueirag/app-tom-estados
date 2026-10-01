-- =====================================================================
-- Zonas de las rutas (importadas de un KML)
--   * rutas.zona: polígonos de la ruta en formato
--       [ [ [ [lng, lat], ... ], <agujero opcional>, ... ], <otro polígono>, ... ]
--     (lista de polígonos; cada polígono es una lista de anillos: el primero
--     es el borde y los siguientes, agujeros). Se guarda también el
--     rectángulo que la contiene para descartar rápido.
--   * ruta_de_punto(lat, lng): la ruta cuya zona contiene ese punto.
--   * asignar_rutas_por_zona(reemplazar): pone a cada cuenta con ubicación
--     la ruta de su zona (y con eso su operador). Solo admin.
--   * Cuando una cuenta sin ruta recibe ubicación (GPS del operador o
--     dirección), toma sola la ruta de su zona y su operador.
-- =====================================================================

alter table public.rutas
  add column zona     jsonb,
  add column zona_min_lat double precision,
  add column zona_max_lat double precision,
  add column zona_min_lng double precision,
  add column zona_max_lng double precision;

-- Rectángulo que contiene la zona (se calcula solo)
create or replace function public.rutas_calcular_rectangulo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.zona is null or jsonb_typeof(new.zona) <> 'array' or jsonb_array_length(new.zona) = 0 then
    new.zona := null;
    new.zona_min_lat := null; new.zona_max_lat := null;
    new.zona_min_lng := null; new.zona_max_lng := null;
    return new;
  end if;
  select min((p ->> 1)::double precision), max((p ->> 1)::double precision),
         min((p ->> 0)::double precision), max((p ->> 0)::double precision)
    into new.zona_min_lat, new.zona_max_lat, new.zona_min_lng, new.zona_max_lng
  from jsonb_array_elements(new.zona) poligono,
       jsonb_array_elements(poligono -> 0) p;
  return new;
end;
$$;
revoke execute on function public.rutas_calcular_rectangulo() from public, anon, authenticated;

create trigger rutas_rectangulo
  before insert or update of zona on public.rutas
  for each row execute function public.rutas_calcular_rectangulo();

-- ¿El punto está dentro del anillo? (método del rayo)
create or replace function public.punto_en_anillo(p_lat double precision, p_lng double precision, p_anillo jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int := jsonb_array_length(p_anillo);
  i int;
  j int;
  xi double precision; yi double precision;
  xj double precision; yj double precision;
  dentro boolean := false;
begin
  if n < 3 then
    return false;
  end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    xi := (p_anillo -> i ->> 0)::double precision; yi := (p_anillo -> i ->> 1)::double precision;
    xj := (p_anillo -> j ->> 0)::double precision; yj := (p_anillo -> j ->> 1)::double precision;
    if ((yi > p_lat) <> (yj > p_lat)) and (p_lng < (xj - xi) * (p_lat - yi) / (yj - yi) + xi) then
      dentro := not dentro;
    end if;
    j := i;
  end loop;
  return dentro;
end;
$$;

create or replace function public.punto_en_zona(p_lat double precision, p_lng double precision, p_zona jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_poligono jsonb;
  v_agujero  int;
  v_adentro  boolean;
begin
  for v_poligono in select * from jsonb_array_elements(p_zona) loop
    if public.punto_en_anillo(p_lat, p_lng, v_poligono -> 0) then
      v_adentro := true;
      for v_agujero in 1 .. jsonb_array_length(v_poligono) - 1 loop
        if public.punto_en_anillo(p_lat, p_lng, v_poligono -> v_agujero) then
          v_adentro := false;
        end if;
      end loop;
      if v_adentro then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

-- Ruta cuya zona contiene el punto (security definer: la usa el trigger de
-- cuentas también cuando sincroniza un operador, que no ve la tabla rutas)
create or replace function public.ruta_de_punto(p_lat double precision, p_lng double precision)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.nombre
  from public.rutas r
  where r.zona is not null
    and p_lat between r.zona_min_lat and r.zona_max_lat
    and p_lng between r.zona_min_lng and r.zona_max_lng
    and public.punto_en_zona(p_lat, p_lng, r.zona)
  order by coalesce(substring(r.nombre from '(\d{1,9})\s*$')::int, 100000), r.nombre
  limit 1;
$$;
revoke execute on function public.ruta_de_punto(double precision, double precision) from public, anon;
grant execute on function public.ruta_de_punto(double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------
-- Cuenta sin ruta que recibe ubicación: toma la ruta de su zona.
-- (Se llama "a_" para correr antes que cuentas_operador_de_ruta.)
-- ---------------------------------------------------------------------
create or replace function public.cuentas_ruta_por_zona()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruta text;
  v_operador uuid;
begin
  if btrim(coalesce(new.ruta, '')) <> '' or new.latitud is null or new.longitud is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.latitud is not distinct from old.latitud and new.longitud is not distinct from old.longitud
     and new.ruta is not distinct from old.ruta then
    return new;
  end if;
  v_ruta := public.ruta_de_punto(new.latitud, new.longitud);
  if v_ruta is null then
    return new;
  end if;
  new.ruta := v_ruta;
  if new.operador_id is null or tg_op = 'UPDATE' and new.operador_id is not distinct from old.operador_id then
    select r.operador_id into v_operador from public.rutas r where r.nombre = v_ruta;
    new.operador_id := coalesce(v_operador, new.operador_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.cuentas_ruta_por_zona() from public, anon, authenticated;

create trigger cuentas_a_ruta_por_zona
  before insert or update of latitud, longitud, ruta on public.cuentas
  for each row execute function public.cuentas_ruta_por_zona();

-- ---------------------------------------------------------------------
-- Asignación masiva por zona (botón del admin)
--   p_reemplazar = false → solo cuentas sin ruta
--   p_reemplazar = true  → también cambia la ruta de las que caen en otra zona
-- Se ejecuta con la sesión del admin (RLS + historial de cambios).
-- ---------------------------------------------------------------------
create or replace function public.asignar_rutas_por_zona(p_reemplazar boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_sin_ubicacion int;
  v_fuera int;
  v_rutas int;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede hacer esto.' using errcode = '42501';
  end if;

  select count(*) into v_rutas from public.rutas where zona is not null;
  if v_rutas = 0 then
    raise exception 'Todavía no hay zonas cargadas. Importá el KML primero.' using errcode = 'P0001';
  end if;

  with calculo as (
    select c.id, c.ruta, public.ruta_de_punto(c.latitud, c.longitud) as nueva
    from public.cuentas c
    where c.activa and c.latitud is not null and c.longitud is not null
      and (p_reemplazar or c.ruta = '')
  ),
  cambios as (
    update public.cuentas c
    set ruta = k.nueva
    from calculo k
    where c.id = k.id and k.nueva is not null and k.nueva is distinct from k.ruta
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from cambios;

  select count(*) into v_sin_ubicacion
  from public.cuentas c
  where c.activa and (c.latitud is null or c.longitud is null) and (p_reemplazar or c.ruta = '');

  select count(*) into v_fuera
  from public.cuentas c
  where c.activa and c.latitud is not null and c.longitud is not null
    and (p_reemplazar or c.ruta = '')
    and public.ruta_de_punto(c.latitud, c.longitud) is null;

  return jsonb_build_object(
    'asignadas', coalesce(array_length(v_ids, 1), 0),
    'ids', to_jsonb(v_ids),
    'sin_ubicacion', v_sin_ubicacion,
    'fuera_de_zona', v_fuera
  );
end;
$$;
revoke execute on function public.asignar_rutas_por_zona(boolean) from public, anon;
grant execute on function public.asignar_rutas_por_zona(boolean) to authenticated;

-- v_rutas: se agrega si la ruta tiene zona
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
    end                                                  as repartida,
    r.zona is not null                                   as tiene_zona
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
  coalesce(substring(t.ruta from '(\d{1,9})\s*$')::int, 100000) as orden,
  coalesce(t.tiene_zona, false)                          as tiene_zona
from todas t
left join public.perfiles op on op.id = t.operador_id;
