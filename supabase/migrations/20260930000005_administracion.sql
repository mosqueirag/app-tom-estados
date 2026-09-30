-- =====================================================================
-- 05 · Soporte para el módulo administrador
--   * La "última lectura" de una cuenta no se puede cambiar con un período
--     abierto (así la lectura anterior no cambia a mitad de período).
--   * cerrar_periodo: primero marca el período cerrado y después copia las
--     lecturas (necesario por la regla anterior).
--   * v_operadores: operadores con cantidad de lecturas cargadas.
--   * v_conflictos: conflictos con la lectura que ya estaba.
--   * cuentas_pendientes(periodo): cuentas activas sin lectura en el período.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Proteger la última lectura mientras hay un período activo
-- ---------------------------------------------------------------------
create or replace function public.cuentas_proteger_ultima_lectura()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.ultima_lectura is distinct from old.ultima_lectura
      or new.fecha_ultima_lectura is distinct from old.fecha_ultima_lectura
      or new.ultimo_consumo is distinct from old.ultimo_consumo)
     and exists (select 1 from public.periodos where activo) then
    raise exception 'No se puede cambiar la última lectura de la cuenta % mientras hay un período abierto.', old.numero_cuenta
      using errcode = 'P0001',
            hint = 'Cerrá el período o cambiá solo titular, dirección o medidor.';
  end if;
  return new;
end;
$$;

create trigger cuentas_antes_update_ultima_lectura
  before update on public.cuentas
  for each row execute function public.cuentas_proteger_ultima_lectura();

-- ---------------------------------------------------------------------
-- cerrar_periodo (misma lógica que la migración 04, pero cierra primero)
-- ---------------------------------------------------------------------
create or replace function public.cerrar_periodo(p_periodo_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_periodo      public.periodos;
  v_resumen      jsonb;
  v_actualizadas int;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cerrar el período.' using errcode = '42501';
  end if;

  select * into v_periodo from public.periodos where id = p_periodo_id for update;
  if not found then
    raise exception 'El período no existe.' using errcode = 'P0002';
  end if;
  if not v_periodo.activo then
    raise exception 'El período "%" ya está cerrado.', v_periodo.nombre using errcode = 'P0001';
  end if;

  v_resumen := public.resumen_periodo(p_periodo_id);

  -- 1) Cerrar el período
  update public.periodos
  set activo = false,
      fecha_cierre = (now() at time zone 'America/Argentina/Buenos_Aires')::date,
      cerrado_por = auth.uid()
  where id = p_periodo_id;

  -- 2) Copiar cada lectura válida a su cuenta
  update public.cuentas c
  set ultima_lectura       = l.lectura_actual,
      fecha_ultima_lectura = (l.fecha_lectura at time zone 'America/Argentina/Buenos_Aires')::date,
      ultimo_consumo       = case when l.consumo >= 0 then l.consumo else null end
  from public.lecturas l
  where l.cuenta_id = c.id
    and l.periodo_id = p_periodo_id
    and not l.sin_lectura
    and l.lectura_actual is not null;
  get diagnostics v_actualizadas = row_count;

  return v_resumen || jsonb_build_object(
    'cuentas_actualizadas', v_actualizadas,
    'activo', false,
    'fecha_cierre', (now() at time zone 'America/Argentina/Buenos_Aires')::date
  );
end;
$$;

-- ---------------------------------------------------------------------
-- v_operadores
-- ---------------------------------------------------------------------
create or replace view public.v_operadores
with (security_invoker = true) as
select
  p.id,
  p.nombre,
  p.email,
  p.usuario,
  p.rol,
  p.activo,
  p.created_at,
  count(l.id) filter (where per.activo)                    as lecturas_periodo_activo,
  count(l.id)                                              as lecturas_total,
  max(l.fecha_lectura)                                     as ultima_lectura_at,
  (select count(*) from public.lecturas_conflictos lc
    where lc.operador_id = p.id and not lc.resuelto)       as conflictos_pendientes
from public.perfiles p
left join public.lecturas l  on l.operador_id = p.id
left join public.periodos per on per.id = l.periodo_id
group by p.id;

-- ---------------------------------------------------------------------
-- v_conflictos
-- ---------------------------------------------------------------------
create or replace view public.v_conflictos
with (security_invoker = true) as
select
  lc.id,
  lc.periodo_id,
  per.nombre               as periodo_nombre,
  per.activo               as periodo_activo,
  lc.cuenta_id,
  c.numero_cuenta,
  c.titular,
  c.direccion,
  c.medidor,
  lc.operador_id,
  op.nombre                as operador_nombre,
  lc.lectura_actual,
  lc.sin_lectura,
  lc.observacion,
  lc.fecha_lectura,
  lc.motivo,
  lc.created_at,
  lc.resuelto,
  lc.resolucion,
  lc.resuelto_at,
  l.id                     as existente_id,
  l.lectura_actual         as existente_lectura_actual,
  l.sin_lectura            as existente_sin_lectura,
  l.observacion            as existente_observacion,
  l.fecha_lectura          as existente_fecha_lectura,
  opl.nombre               as existente_operador_nombre
from public.lecturas_conflictos lc
join public.cuentas  c   on c.id = lc.cuenta_id
join public.periodos per on per.id = lc.periodo_id
left join public.perfiles op  on op.id = lc.operador_id
left join public.lecturas l   on l.cuenta_id = lc.cuenta_id and l.periodo_id = lc.periodo_id
left join public.perfiles opl on opl.id = l.operador_id;

-- ---------------------------------------------------------------------
-- cuentas_pendientes(periodo)
-- ---------------------------------------------------------------------
create or replace function public.cuentas_pendientes(p_periodo_id uuid)
returns setof public.cuentas
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.cuentas c
  where c.activa
    and public.es_admin()
    and not exists (
      select 1 from public.lecturas l
      where l.cuenta_id = c.id and l.periodo_id = p_periodo_id
    )
  order by c.numero_cuenta;
$$;

revoke all on public.v_operadores, public.v_conflictos from anon;
grant select on public.v_operadores, public.v_conflictos to authenticated;
revoke execute on function public.cuentas_pendientes(uuid) from public, anon;
grant execute on function public.cuentas_pendientes(uuid) to authenticated;
