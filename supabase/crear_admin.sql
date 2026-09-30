-- =====================================================================
-- Convertir un usuario en ADMINISTRADOR.
--
-- 1. En Supabase: Authentication → Users → "Add user" → "Create new user".
--    Cargá email y contraseña y tildá "Auto Confirm User".
-- 2. Reemplazá el email de abajo por el que cargaste y ejecutá esto en
--    SQL Editor → New query → Run.
-- =====================================================================

update public.perfiles
set rol = 'admin',
    activo = true,
    nombre = 'Administrador'          -- podés cambiar el nombre
where email = 'admin@ejemplo.com';    -- ← tu email

-- Verificación: tiene que aparecer una fila con rol = admin
select id, nombre, email, rol, activo from public.perfiles where rol = 'admin';
