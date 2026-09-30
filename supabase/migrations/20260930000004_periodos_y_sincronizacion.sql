-- =====================================================================
-- 04 · Funciones de negocio (se llaman desde la app con supabase.rpc)
--   sincronizar_lecturas  → operador sube sus lecturas pendientes
--   abrir_periodo         → admin
--   resumen_periodo       → admin, antes de cerrar
--   cerrar_periodo        → admin
--   resolver_conflicto    → admin
-- Todas son SECURITY INVOKER: corren con los permisos (y la RLS) de quien
-- llama, y además verifican el rol explícitamente para dar un mensaje claro.
-- =====================================================================

-- ---------------------------------------------------------------------
-- sincronizar_lecturas(p_lecturas jsonb)
--
-- Recibe un array de lecturas generadas en el celular:
--   [{ "id": uuid, "cuenta_id": uuid, "periodo_id": uuid,
--      "lectura_actual": number|null, "observacion": text|null,
--      "sin_lectura": bool, "fecha_lectura": timestamptz }, ...]
--
-- Devuelve una fila por lectura con estado:
--   'sincronizada' → quedó guardada (o ya estaba: reintentar no duplica)
--   'conflicto'    → no se aceptó (cuenta ya leída o período cerrado);
--                    queda en lecturas_conflictos, visible para el admin
--   'rechazada'    → dato inválido; el celular la conserva para revisarla
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_lecturas(p_lecturas jsonb)
returns table (lectura_id uuid, estado text, mensaje text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item            jsonb;
  v_id              uuid;
  v_cuenta_id       uuid;
  v_periodo_id      uuid;
  v_lectura_actual  numeric;
  v_observacion     text;
  v_sin_lectura     boolean;
  v_fecha_lectura   timestamptz;
  v_existente       uuid;
  v_filas           int;
begin
  if auth.uid() is null then
    raise exception 'Tenés que iniciar sesión para sincronizar.' using errcode = '42501';
  end if;
  if not public.es_operador_activo() then
    raise exception 'Tu usuario está desactivado. Consultá con el administrador.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lecturas) is distinct from 'array' then
    raise exception 'Se esperaba una lista de lecturas.' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_lecturas)
  loop
    lectura_id := null;
    begin
      v_id             := (v_item ->> 'id')::uuid;
      lectura_id       := v_id;
      v_cuenta_id      := (v_item ->> 'cuenta_id')::uuid;
      v_periodo_id     := (v_item ->> 'periodo_id')::uuid;
      v_sin_lectura    := coalesce((v_item ->> 'sin_lectura')::boolean, false);
      v_lectura_actual := case when v_sin_lectura then null else (v_item ->> 'lectura_actual')::numeric end;
      v_observacion    := nullif(btrim(v_item ->> 'observacion'), '');
      v_fecha_lectura  := coalesce((v_item ->> 'fecha_lectura')::timestamptz, now());

      if v_id is null or v_cuenta_id is null or v_periodo_id is null then
        raise exception 'Faltan datos (id, cuenta o período).' using errcode = '22023';
      end if;

      -- ¿Ya se había procesado este mismo id? (reintento) → mismo resultado
      if exists (select 1 from public.lecturas where id = v_id) then
        estado := 'sincronizada'; mensaje := null;
        return next; continue;
      end if;
      if exists (select 1 from public.lecturas_conflictos where id = v_id) then
        estado := 'conflicto'; mensaje := 'Esta lectura ya estaba registrada como conflicto.';
        return next; continue;
      end if;

      -- ¿El período sigue activo?
      if not exists (select 1 from public.periodos where id = v_periodo_id and activo) then
        insert into public.lecturas_conflictos (
          id, cuenta_id, periodo_id, operador_id, lectura_actual, observacion,
          sin_lectura, fecha_lectura, motivo
        ) values (
          v_id, v_cuenta_id, v_periodo_id, auth.uid(), v_lectura_actual, v_observacion,
          v_sin_lectura, v_fecha_lectura, 'periodo_cerrado'
        ) on conflict (id) do nothing;
        estado := 'conflicto'; mensaje := 'El período ya fue cerrado. El administrador verá esta lectura.';
        return next; continue;
      end if;

      begin
        insert into public.lecturas (
          id, cuenta_id, periodo_id, operador_id, lectura_actual, observacion,
          sin_lectura, fecha_lectura
        ) values (
          v_id, v_cuenta_id, v_periodo_id, auth.uid(), v_lectura_actual, v_observacion,
          v_sin_lectura, v_fecha_lectura
        ) on conflict (id) do nothing;
        get diagnostics v_filas = row_count;

        estado := 'sincronizada'; mensaje := null;
      exception when unique_violation then
        -- Otra lectura (de otro operador u otro celular) ya ocupa esta cuenta en el período
        select l.id into v_existente
        from public.lecturas l
        where l.cuenta_id = v_cuenta_id and l.periodo_id = v_periodo_id;

        insert into public.lecturas_conflictos (
          id, cuenta_id, periodo_id, operador_id, lectura_actual, observacion,
          sin_lectura, fecha_lectura, motivo, lectura_existente_id
        ) values (
          v_id, v_cuenta_id, v_periodo_id, auth.uid(), v_lectura_actual, v_observacion,
          v_sin_lectura, v_fecha_lectura, 'ya_leida', v_existente
        ) on conflict (id) do nothing;

        estado := 'conflicto'; mensaje := 'Esta cuenta ya fue leída en este período por otro operador.';
      end;
      return next;

    exception
      when insufficient_privilege then
        estado := 'rechazada'; mensaje := 'No tenés permiso para cargar esta lectura (¿cuenta dada de baja?).';
        return next;
      when check_violation then
        estado := 'rechazada'; mensaje := 'La lectura debe ser un número mayor o igual a 0.';
        return next;
      when foreign_key_violation then
        estado := 'rechazada'; mensaje := 'La cuenta o el período no existen.';
        return next;
      when invalid_text_representation or numeric_value_out_of_range
           or invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then
        estado := 'rechazada'; mensaje := 'Datos inválidos: ' || sqlerrm;
        return next;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- abrir_periodo(nombre, fecha_inicio)
-- ---------------------------------------------------------------------
create or replace function public.abrir_periodo(p_nombre text, p_fecha_inicio date default null)
returns public.periodos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_periodo public.periodos;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede abrir un período.' using errcode = '42501';
  end if;
  if exists (select 1 from public.periodos where activo) then
    raise exception 'Ya hay un período activo. Cerralo antes de abrir uno nuevo.' using errcode = 'P0001';
  end if;

  insert into public.periodos (nombre, fecha_inicio, activo)
  values (
    btrim(p_nombre),
    coalesce(p_fecha_inicio, (now() at time zone 'America/Argentina/Buenos_Aires')::date),
    true
  )
  returning * into v_periodo;

  return v_periodo;
exception when unique_violation then
  raise exception 'Ya hay un período activo. Cerralo antes de abrir uno nuevo.' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------
-- resumen_periodo(periodo_id) → números para el panel y para confirmar
-- el cierre.
-- ---------------------------------------------------------------------
create or replace function public.resumen_periodo(p_periodo_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_resultado jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver el resumen del período.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'periodo_id',             p.id,
    'nombre',                 p.nombre,
    'activo',                 p.activo,
    'fecha_inicio',           p.fecha_inicio,
    'fecha_cierre',           p.fecha_cierre,
    'cuentas_activas',        (select count(*) from public.cuentas where activa),
    'lecturas',               (select count(*) from public.lecturas where periodo_id = p.id),
    'con_lectura',            (select count(*) from public.lecturas where periodo_id = p.id and not sin_lectura),
    'sin_lectura',            (select count(*) from public.lecturas where periodo_id = p.id and sin_lectura),
    'pendientes',             (select count(*) from public.cuentas c
                                where c.activa
                                  and not exists (select 1 from public.lecturas l
                                                  where l.cuenta_id = c.id and l.periodo_id = p.id)),
    'alertas_menor_anterior', (select count(*) from public.v_lecturas v
                                where v.periodo_id = p.id and v.alerta_menor_anterior),
    'alertas_consumo_anomalo',(select count(*) from public.v_lecturas v
                                where v.periodo_id = p.id and v.alerta_consumo_anomalo),
    'conflictos_pendientes',  (select count(*) from public.lecturas_conflictos
                                where periodo_id = p.id and not resuelto)
  )
  into v_resultado
  from public.periodos p
  where p.id = p_periodo_id;

  if v_resultado is null then
    raise exception 'El período no existe.' using errcode = 'P0002';
  end if;
  return v_resultado;
end;
$$;

-- ---------------------------------------------------------------------
-- cerrar_periodo(periodo_id)
--
-- Solo admin. Copia cada lectura válida del período a la cuenta:
--   cuentas.ultima_lectura       = lectura_actual
--   cuentas.fecha_ultima_lectura = fecha de la lectura (hora Argentina)
--   cuentas.ultimo_consumo       = consumo (null si fue negativo: vuelta de
--                                  medidor o cambio de medidor)
-- Las lecturas "sin lectura" no modifican la cuenta.
-- Marca el período como cerrado. Todo ocurre en una sola transacción.
-- Mientras el período está abierto, la lectura anterior NO cambia.
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

  update public.periodos
  set activo = false,
      fecha_cierre = (now() at time zone 'America/Argentina/Buenos_Aires')::date,
      cerrado_por = auth.uid()
  where id = p_periodo_id;

  return v_resumen || jsonb_build_object('cuentas_actualizadas', v_actualizadas, 'activo', false);
end;
$$;

-- ---------------------------------------------------------------------
-- resolver_conflicto(conflicto_id, accion)
--   'descartar'  → se queda la lectura que ya estaba
--   'reemplazar' → la lectura del conflicto pasa a ser la oficial; la que
--                  estaba se guarda como conflicto resuelto ('reemplazada')
-- Solo en períodos activos y solo para conflictos 'ya_leida'.
-- ---------------------------------------------------------------------
create or replace function public.resolver_conflicto(p_conflicto_id uuid, p_accion text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conf  public.lecturas_conflictos;
  v_vieja public.lecturas;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede resolver conflictos.' using errcode = '42501';
  end if;
  if p_accion not in ('descartar', 'reemplazar') then
    raise exception 'Acción inválida: usá "descartar" o "reemplazar".' using errcode = '22023';
  end if;

  select * into v_conf from public.lecturas_conflictos where id = p_conflicto_id for update;
  if not found then
    raise exception 'El conflicto no existe.' using errcode = 'P0002';
  end if;
  if v_conf.resuelto then
    raise exception 'El conflicto ya fue resuelto.' using errcode = 'P0001';
  end if;

  if p_accion = 'reemplazar' then
    if v_conf.motivo <> 'ya_leida' then
      raise exception 'Solo se pueden reemplazar lecturas de un período abierto.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.periodos where id = v_conf.periodo_id and activo) then
      raise exception 'El período está cerrado; la lectura ya no se puede reemplazar.' using errcode = 'P0001';
    end if;

    select * into v_vieja from public.lecturas
    where cuenta_id = v_conf.cuenta_id and periodo_id = v_conf.periodo_id
    for update;

    if found then
      insert into public.lecturas_conflictos (
        id, cuenta_id, periodo_id, operador_id, lectura_actual, observacion, sin_lectura,
        fecha_lectura, motivo, resuelto, resolucion, resuelto_por, resuelto_at
      ) values (
        v_vieja.id, v_vieja.cuenta_id, v_vieja.periodo_id, v_vieja.operador_id,
        v_vieja.lectura_actual, v_vieja.observacion, v_vieja.sin_lectura,
        v_vieja.fecha_lectura, 'reemplazada', true, 'descartada', auth.uid(), now()
      );
      delete from public.lecturas where id = v_vieja.id;
    end if;

    insert into public.lecturas (
      id, cuenta_id, periodo_id, operador_id, lectura_actual, observacion, sin_lectura, fecha_lectura
    ) values (
      v_conf.id, v_conf.cuenta_id, v_conf.periodo_id, v_conf.operador_id,
      v_conf.lectura_actual, v_conf.observacion, v_conf.sin_lectura, v_conf.fecha_lectura
    );

    update public.lecturas_conflictos
    set resuelto = true, resolucion = 'reemplaza', resuelto_por = auth.uid(), resuelto_at = now(),
        lectura_existente_id = null
    where id = v_conf.id;
  else
    update public.lecturas_conflictos
    set resuelto = true, resolucion = 'descartada', resuelto_por = auth.uid(), resuelto_at = now()
    where id = v_conf.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución: nada para anónimos.
-- ---------------------------------------------------------------------
revoke execute on function public.sincronizar_lecturas(jsonb)            from public, anon;
revoke execute on function public.abrir_periodo(text, date)              from public, anon;
revoke execute on function public.resumen_periodo(uuid)                  from public, anon;
revoke execute on function public.cerrar_periodo(uuid)                   from public, anon;
revoke execute on function public.resolver_conflicto(uuid, text)         from public, anon;
revoke execute on function public.crear_perfil_nuevo_usuario()           from public, anon, authenticated;

grant execute on function public.sincronizar_lecturas(jsonb)    to authenticated;
grant execute on function public.abrir_periodo(text, date)      to authenticated;
grant execute on function public.resumen_periodo(uuid)          to authenticated;
grant execute on function public.cerrar_periodo(uuid)           to authenticated;
grant execute on function public.resolver_conflicto(uuid, text) to authenticated;
grant execute on function public.es_admin()                     to authenticated;
grant execute on function public.es_operador_activo()           to authenticated;
