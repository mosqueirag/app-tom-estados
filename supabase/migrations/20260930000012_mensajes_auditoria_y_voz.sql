-- =====================================================================
-- 12 · Mensajes a operadores, historial de cambios y notas de voz
--   * mensajes: avisos cortos del admin (a un operador o a todos). Los
--     inserta la Edge Function asignar-cuentas, que además manda el push.
--   * auditoria: quién creó, cambió o dio de baja cada cuenta u operador.
--     La llenan triggers; solo el admin la puede leer.
--   * audio_path: nota de voz de la lectura (bucket privado notas-voz).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mensajes
-- ---------------------------------------------------------------------
create table public.mensajes (
  id          bigint generated always as identity primary key,
  autor_id    uuid references public.perfiles (id) on delete set null,
  para_id     uuid references public.perfiles (id) on delete cascade, -- null = todos
  texto       text not null check (char_length(btrim(texto)) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index mensajes_para_idx on public.mensajes (para_id, created_at desc);

alter table public.mensajes enable row level security;
create policy mensajes_admin_todo on public.mensajes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());
create policy mensajes_operador_ver on public.mensajes
  for select to authenticated
  using (public.es_operador_activo() and (para_id is null or para_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- Historial de cambios
-- ---------------------------------------------------------------------
create table public.auditoria (
  id              bigint generated always as identity primary key,
  tabla           text not null,
  registro_id     uuid not null,
  descripcion     text not null default '',
  accion          text not null check (accion in ('alta', 'cambio', 'baja')),
  usuario_id      uuid,
  usuario_nombre  text,
  cambios         jsonb not null default '{}',
  fecha           timestamptz not null default now()
);
create index auditoria_fecha_idx on public.auditoria (fecha desc);
create index auditoria_registro_idx on public.auditoria (tabla, registro_id);

alter table public.auditoria enable row level security;
create policy auditoria_admin_ver on public.auditoria
  for select to authenticated using (public.es_admin());

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Campos que cambian solos (cierre de período, GPS, marcas de tiempo): no se registran
  v_ignorar  text[] := array['updated_at', 'created_at', 'ultima_lectura', 'fecha_ultima_lectura', 'ultimo_consumo', 'latitud', 'longitud', 'orden'];
  v_antes    jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_despues  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_fila     jsonb := coalesce(v_despues, v_antes);
  v_cambios  jsonb := '{}';
  v_campo    text;
  v_usuario  uuid := auth.uid();
  v_nombre   text;
  v_accion   text;
begin
  if tg_op = 'UPDATE' then
    for v_campo in select jsonb_object_keys(v_despues) loop
      if not v_campo = any (v_ignorar) and (v_antes -> v_campo) is distinct from (v_despues -> v_campo) then
        v_cambios := v_cambios || jsonb_build_object(v_campo, jsonb_build_array(v_antes -> v_campo, v_despues -> v_campo));
      end if;
    end loop;
    if v_cambios = '{}' then
      return null;
    end if;
    v_accion := case
      when v_cambios ? 'activa' and (v_despues ->> 'activa')::boolean is false then 'baja'
      when v_cambios ? 'activo' and (v_despues ->> 'activo')::boolean is false then 'baja'
      else 'cambio' end;
  else
    v_cambios := v_fila - v_ignorar;
    v_accion := case when tg_op = 'INSERT' then 'alta' else 'baja' end;
  end if;

  if v_usuario is not null then
    select p.nombre into v_nombre from public.perfiles p where p.id = v_usuario;
  end if;

  insert into public.auditoria (tabla, registro_id, descripcion, accion, usuario_id, usuario_nombre, cambios)
  values (
    tg_table_name,
    (v_fila ->> 'id')::uuid,
    case tg_table_name
      when 'cuentas' then concat(v_fila ->> 'numero_cuenta', ' · ', v_fila ->> 'titular')
      else coalesce(v_fila ->> 'nombre', '') end,
    v_accion,
    v_usuario,
    v_nombre,
    v_cambios
  );
  return null;
end;
$$;

revoke execute on function public.registrar_auditoria() from public, anon, authenticated;

create trigger cuentas_auditoria
  after insert or update or delete on public.cuentas
  for each row execute function public.registrar_auditoria();

create trigger perfiles_auditoria
  after insert or update or delete on public.perfiles
  for each row execute function public.registrar_auditoria();

-- ---------------------------------------------------------------------
-- Notas de voz
-- ---------------------------------------------------------------------
alter table public.lecturas add column audio_path text;
alter table public.lecturas_conflictos add column audio_path text;

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
  v_audio  text;
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
    v_id    := (v_item ->> 'id')::uuid;
    v_lat   := (v_item ->> 'latitud')::double precision;
    v_lng   := (v_item ->> 'longitud')::double precision;
    v_prec  := (v_item ->> 'precision')::real;
    v_foto  := nullif(v_item ->> 'foto_path', '');
    v_audio := nullif(v_item ->> 'audio_path', '');

    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      v_lat := null; v_lng := null; v_prec := null;
    end if;
    -- Los archivos solo pueden estar en la carpeta del operador y con el id de la lectura
    if v_foto is not null and v_foto <> auth.uid()::text || '/' || v_id::text || '.jpg' then
      v_foto := null;
    end if;
    if v_audio is not null and v_audio !~ ('^' || auth.uid()::text || '/' || v_id::text || '\.(webm|m4a|mp4|ogg)$') then
      v_audio := null;
    end if;

    update public.lecturas
    set latitud       = coalesce(v_lat, latitud),
        longitud      = coalesce(v_lng, longitud),
        precision_gps = coalesce(v_prec, precision_gps),
        foto_path     = coalesce(v_foto, foto_path),
        audio_path    = coalesce(v_audio, audio_path)
    where id = v_id and operador_id = auth.uid()
    returning cuenta_id into v_cuenta;
    get diagnostics v_filas = row_count;

    if v_filas = 0 then
      update public.lecturas_conflictos
      set latitud       = coalesce(v_lat, latitud),
          longitud      = coalesce(v_lng, longitud),
          precision_gps = coalesce(v_prec, precision_gps),
          foto_path     = coalesce(v_foto, foto_path),
          audio_path    = coalesce(v_audio, audio_path)
      where id = v_id and operador_id = auth.uid();
      get diagnostics v_filas = row_count;
    elsif v_lat is not null and coalesce(v_prec, 0) <= 50 then
      update public.cuentas set latitud = v_lat, longitud = v_lng where id = v_cuenta;
    end if;
    v_total := v_total + v_filas;
  end loop;
  return v_total;
end;
$$;

create or replace function public.lecturas_copiar_extras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.latitud is null and new.foto_path is null and new.audio_path is null then
    if tg_table_name = 'lecturas' then
      select c.latitud, c.longitud, c.precision_gps, c.foto_path, c.audio_path
        into new.latitud, new.longitud, new.precision_gps, new.foto_path, new.audio_path
      from public.lecturas_conflictos c where c.id = new.id;
    else
      select l.latitud, l.longitud, l.precision_gps, l.foto_path, l.audio_path
        into new.latitud, new.longitud, new.precision_gps, new.foto_path, new.audio_path
      from public.lecturas l where l.id = new.id;
    end if;
  end if;
  return new;
end;
$$;

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
  l.foto_path,
  l.audio_path
from public.lecturas l
join public.cuentas  c   on c.id = l.cuenta_id
join public.periodos p   on p.id = l.periodo_id
left join public.perfiles op  on op.id = l.operador_id
left join public.perfiles cor on cor.id = l.corregida_por
cross join public.configuracion cfg;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage (Postgres local): se omite el bucket de notas de voz.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('notas-voz', 'notas-voz', false, 2097152,
          array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg', 'audio/x-m4a'])
  on conflict (id) do nothing;

  execute $p$
    create policy voz_operador_subir on storage.objects for insert to authenticated
    with check (bucket_id = 'notas-voz'
                and (storage.foldername(name))[1] = (select auth.uid())::text
                and public.es_operador_activo())
  $p$;
  execute $p$
    create policy voz_operador_reemplazar on storage.objects for update to authenticated
    using (bucket_id = 'notas-voz' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'notas-voz'
                and (storage.foldername(name))[1] = (select auth.uid())::text
                and public.es_operador_activo())
  $p$;
  execute $p$
    create policy voz_ver on storage.objects for select to authenticated
    using (bucket_id = 'notas-voz'
           and (public.es_admin() or (storage.foldername(name))[1] = (select auth.uid())::text))
  $p$;
  execute $p$
    create policy voz_admin_borrar on storage.objects for delete to authenticated
    using (bucket_id = 'notas-voz' and public.es_admin())
  $p$;
end;
$$;
