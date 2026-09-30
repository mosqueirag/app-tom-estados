-- =====================================================================
-- 10 · Foto del medidor y ubicación GPS de cada lectura
--   * El celular saca la foto y toma la ubicación al cargar la lectura, sin
--     señal. Al sincronizar sube la foto a Storage (bucket privado
--     fotos-medidores, carpeta = id del operador) y después manda la
--     ubicación y la ruta de la foto con registrar_extras_lecturas.
--   * Las cuentas guardan la última ubicación buena (para "Cómo llegar").
--   * configuracion.foto_obligatoria: si es true, no se puede confirmar una
--     lectura sin foto.
-- =====================================================================

alter table public.lecturas
  add column latitud       double precision check (latitud between -90 and 90),
  add column longitud      double precision check (longitud between -180 and 180),
  add column precision_gps real,
  add column foto_path     text;

alter table public.lecturas_conflictos
  add column latitud       double precision check (latitud between -90 and 90),
  add column longitud      double precision check (longitud between -180 and 180),
  add column precision_gps real,
  add column foto_path     text;

alter table public.cuentas
  add column latitud  double precision check (latitud between -90 and 90),
  add column longitud double precision check (longitud between -180 and 180);

alter table public.configuracion
  add column foto_obligatoria boolean not null default false;

-- ---------------------------------------------------------------------
-- registrar_extras_lecturas(p_extras jsonb)
--   [{ "id": uuid, "latitud": n|null, "longitud": n|null, "precision": n|null,
--      "foto_path": text|null }, ...]
-- Solo toca lecturas (o conflictos) del mismo operador. Devuelve cuántas
-- actualizó. SECURITY DEFINER porque el operador no puede hacer UPDATE
-- sobre lecturas; los controles están acá adentro.
-- ---------------------------------------------------------------------
create or replace function public.registrar_extras_lecturas(p_extras jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_id     uuid;
  v_lat    double precision;
  v_lng    double precision;
  v_prec   real;
  v_foto   text;
  v_cuenta uuid;
  v_total  int := 0;
  v_filas  int;
begin
  if auth.uid() is null or not public.es_operador_activo() then
    raise exception 'No tenés permiso para enviar datos de lecturas.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_extras) is distinct from 'array' then
    raise exception 'Se esperaba una lista.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_extras)
  loop
    v_id   := (v_item ->> 'id')::uuid;
    v_lat  := (v_item ->> 'latitud')::double precision;
    v_lng  := (v_item ->> 'longitud')::double precision;
    v_prec := (v_item ->> 'precision')::real;
    v_foto := nullif(v_item ->> 'foto_path', '');

    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      v_lat := null; v_lng := null; v_prec := null;
    end if;
    -- La foto solo puede estar en la carpeta del operador y con el id de la lectura
    if v_foto is not null and v_foto <> auth.uid()::text || '/' || v_id::text || '.jpg' then
      v_foto := null;
    end if;

    update public.lecturas
    set latitud       = coalesce(v_lat, latitud),
        longitud      = coalesce(v_lng, longitud),
        precision_gps = coalesce(v_prec, precision_gps),
        foto_path     = coalesce(v_foto, foto_path)
    where id = v_id and operador_id = auth.uid()
    returning cuenta_id into v_cuenta;
    get diagnostics v_filas = row_count;

    if v_filas = 0 then
      update public.lecturas_conflictos
      set latitud       = coalesce(v_lat, latitud),
          longitud      = coalesce(v_lng, longitud),
          precision_gps = coalesce(v_prec, precision_gps),
          foto_path     = coalesce(v_foto, foto_path)
      where id = v_id and operador_id = auth.uid();
      get diagnostics v_filas = row_count;
    elsif v_lat is not null and coalesce(v_prec, 0) <= 50 then
      -- Ubicación buena: queda como la ubicación del medidor
      update public.cuentas set latitud = v_lat, longitud = v_lng where id = v_cuenta;
    end if;
    v_total := v_total + v_filas;
  end loop;
  return v_total;
end;
$$;

revoke execute on function public.registrar_extras_lecturas(jsonb) from public, anon;
grant execute on function public.registrar_extras_lecturas(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Al pasar una lectura de conflicto a lectura (o al revés, cuando el admin
-- reemplaza), la foto y la ubicación viajan con ella.
-- ---------------------------------------------------------------------
create or replace function public.lecturas_copiar_extras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.latitud is null and new.foto_path is null then
    if tg_table_name = 'lecturas' then
      select c.latitud, c.longitud, c.precision_gps, c.foto_path
        into new.latitud, new.longitud, new.precision_gps, new.foto_path
      from public.lecturas_conflictos c where c.id = new.id;
    else
      select l.latitud, l.longitud, l.precision_gps, l.foto_path
        into new.latitud, new.longitud, new.precision_gps, new.foto_path
      from public.lecturas l where l.id = new.id;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.lecturas_copiar_extras() from public, anon, authenticated;

create trigger lecturas_antes_copiar_extras
  before insert on public.lecturas
  for each row execute function public.lecturas_copiar_extras();

create trigger conflictos_antes_copiar_extras
  before insert on public.lecturas_conflictos
  for each row execute function public.lecturas_copiar_extras();

-- ---------------------------------------------------------------------
-- v_lecturas: se agregan la ubicación y la foto al final
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
  c.ruta,
  l.latitud,
  l.longitud,
  l.precision_gps,
  l.foto_path
from public.lecturas l
join public.cuentas  c   on c.id = l.cuenta_id
join public.periodos p   on p.id = l.periodo_id
left join public.perfiles op  on op.id = l.operador_id
left join public.perfiles cor on cor.id = l.corregida_por
cross join public.configuracion cfg;

-- ---------------------------------------------------------------------
-- Storage: bucket privado para las fotos (solo existe en Supabase)
--   subir/reemplazar: el operador activo, en su propia carpeta
--   ver: el admin, o el operador sus propias fotos
--   borrar: el admin
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage (Postgres local): se omite el bucket de fotos.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('fotos-medidores', 'fotos-medidores', false, 3145728, array['image/jpeg'])
  on conflict (id) do nothing;

  execute $p$
    create policy fotos_operador_subir on storage.objects for insert to authenticated
    with check (bucket_id = 'fotos-medidores'
                and (storage.foldername(name))[1] = (select auth.uid())::text
                and public.es_operador_activo())
  $p$;
  execute $p$
    create policy fotos_operador_reemplazar on storage.objects for update to authenticated
    using (bucket_id = 'fotos-medidores' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'fotos-medidores'
                and (storage.foldername(name))[1] = (select auth.uid())::text
                and public.es_operador_activo())
  $p$;
  execute $p$
    create policy fotos_ver on storage.objects for select to authenticated
    using (bucket_id = 'fotos-medidores'
           and (public.es_admin() or (storage.foldername(name))[1] = (select auth.uid())::text))
  $p$;
  execute $p$
    create policy fotos_admin_borrar on storage.objects for delete to authenticated
    using (bucket_id = 'fotos-medidores' and public.es_admin())
  $p$;
end;
$$;
