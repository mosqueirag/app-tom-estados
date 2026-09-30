-- =====================================================================
-- 02 · Funciones auxiliares y triggers
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers de rol (security definer para poder leer perfiles sin
-- caer en recursión de RLS). Se usan en las políticas.
-- ---------------------------------------------------------------------
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and rol = 'admin' and activo
  );
$$;

create or replace function public.es_operador_activo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where id = auth.uid() and activo
  );
$$;

-- ---------------------------------------------------------------------
-- Crear perfil automáticamente al registrarse un usuario.
-- El rol SIEMPRE arranca como 'operador' (no se toma de los metadatos
-- del usuario para que nadie pueda autoasignarse admin).
-- ---------------------------------------------------------------------
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, nombre, email, usuario, rol)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1), 'Sin nombre'),
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'usuario'), ''),
    'operador'
  );
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- ---------------------------------------------------------------------
-- updated_at automático en cuentas
-- ---------------------------------------------------------------------
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger cuentas_updated_at
  before update on public.cuentas
  for each row execute function public.tocar_updated_at();

create trigger configuracion_updated_at
  before update on public.configuracion
  for each row execute function public.tocar_updated_at();

-- ---------------------------------------------------------------------
-- Antes de insertar una lectura:
--  * lectura_anterior = cuentas.ultima_lectura (valor del servidor, que no
--    cambia mientras el período está abierto)
--  * sincronizado_at = hora del servidor
--  * campos de corrección vacíos
--  * si sin_lectura, lectura_actual = null
-- ---------------------------------------------------------------------
create or replace function public.lecturas_antes_de_insertar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.ultima_lectura into new.lectura_anterior
  from public.cuentas c
  where c.id = new.cuenta_id;

  if new.sin_lectura then
    new.lectura_actual := null;
  end if;

  new.sincronizado_at := now();
  new.corregida_por := null;
  new.corregida_at := null;
  return new;
end;
$$;

create trigger lecturas_antes_insert
  before insert on public.lecturas
  for each row execute function public.lecturas_antes_de_insertar();

-- ---------------------------------------------------------------------
-- Corrección de una lectura (solo admin, por RLS):
--  * no se pueden cambiar cuenta, período, operador ni lectura_anterior
--  * no se puede corregir una lectura de un período cerrado
--  * queda registrado quién y cuándo, y el historial en lecturas_correcciones
-- ---------------------------------------------------------------------
create or replace function public.lecturas_antes_de_actualizar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cuenta_id <> old.cuenta_id
     or new.periodo_id <> old.periodo_id
     or new.operador_id <> old.operador_id
     or new.lectura_anterior is distinct from old.lectura_anterior
     or new.fecha_lectura <> old.fecha_lectura
     or new.sincronizado_at <> old.sincronizado_at then
    raise exception 'Solo se puede corregir la lectura, la observación o marcarla como sin lectura.'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.periodos p where p.id = old.periodo_id and p.activo) then
    raise exception 'No se puede corregir una lectura de un período cerrado.'
      using errcode = 'P0001';
  end if;

  if new.sin_lectura then
    new.lectura_actual := null;
  end if;

  if new.lectura_actual is distinct from old.lectura_actual
     or new.sin_lectura is distinct from old.sin_lectura
     or new.observacion is distinct from old.observacion then
    new.corregida_por := auth.uid();
    new.corregida_at := now();

    insert into public.lecturas_correcciones (
      lectura_id, corregida_por,
      lectura_actual_anterior, lectura_actual_nueva,
      sin_lectura_anterior, sin_lectura_nueva,
      observacion_anterior, observacion_nueva
    ) values (
      old.id, auth.uid(),
      old.lectura_actual, new.lectura_actual,
      old.sin_lectura, new.sin_lectura,
      old.observacion, new.observacion
    );
  else
    new.corregida_por := old.corregida_por;
    new.corregida_at := old.corregida_at;
  end if;

  return new;
end;
$$;

create trigger lecturas_antes_update
  before update on public.lecturas
  for each row execute function public.lecturas_antes_de_actualizar();

-- ---------------------------------------------------------------------
-- Un admin no puede quitarse a sí mismo el rol admin ni desactivarse
-- (evita quedarse sin administradores por error).
-- ---------------------------------------------------------------------
create or replace function public.perfiles_proteger_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.id = auth.uid() and (new.rol <> 'admin' or not new.activo) and old.rol = 'admin' then
    raise exception 'No podés quitarte el rol de administrador ni desactivarte a vos mismo.'
      using errcode = 'P0001';
  end if;
  if new.id <> old.id then
    raise exception 'No se puede cambiar el id de un perfil.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger perfiles_antes_update
  before update on public.perfiles
  for each row execute function public.perfiles_proteger_admin();
