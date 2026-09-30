-- =====================================================================
-- 06 · Registro seguro
-- La clave pública (anon) está en el frontend, así que cualquiera podría
-- intentar registrarse por su cuenta si el registro público de Supabase
-- queda habilitado. Para que eso nunca dé acceso, los perfiles nuevos se
-- crean DESACTIVADOS: solo la Edge Function crear-operador (que verifica
-- que quien llama es admin) o el script crear_admin.sql los activan.
-- Además, en Supabase conviene desactivar "Allow new users to sign up"
-- (ver README).
-- =====================================================================

alter table public.perfiles alter column activo set default false;

create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, nombre, email, usuario, rol, activo)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1), 'Sin nombre'),
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'usuario'), ''),
    'operador',
    false
  );
  return new;
end;
$$;
