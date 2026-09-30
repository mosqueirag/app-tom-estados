-- =====================================================================
-- 11 · Orden de recorrido dentro de cada ruta
--   * cuentas.orden: posición de la cuenta en el recorrido de su ruta.
--   * ordenar_ruta(ruta, ids): el admin guarda el orden de una ruta.
--   * configuracion.localidad: se agrega a la dirección en "Cómo llegar"
--     (Google Maps) cuando la cuenta todavía no tiene ubicación GPS.
-- =====================================================================

alter table public.cuentas add column orden int check (orden > 0);
create index cuentas_ruta_orden_idx on public.cuentas (ruta, orden);

alter table public.configuracion add column localidad text not null default '';

create or replace function public.ordenar_ruta(p_ruta text, p_cuenta_ids uuid[])
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_filas int;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ordenar las rutas.' using errcode = '42501';
  end if;
  update public.cuentas c
  set orden = t.posicion
  from unnest(p_cuenta_ids) with ordinality as t(id, posicion)
  where c.id = t.id and c.ruta = p_ruta;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke execute on function public.ordenar_ruta(text, uuid[]) from public, anon;
grant execute on function public.ordenar_ruta(text, uuid[]) to authenticated;
