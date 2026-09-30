-- =====================================================================
-- 07 · Ajustes de seguridad sugeridos por el asesor de Supabase
--   * Las funciones de trigger no se pueden llamar por la API.
--   * es_admin / es_operador_activo solo para usuarios con sesión.
--   * search_path fijo en tocar_updated_at.
-- =====================================================================

revoke execute on function public.lecturas_antes_de_insertar()      from public, anon, authenticated;
revoke execute on function public.lecturas_antes_de_actualizar()    from public, anon, authenticated;
revoke execute on function public.perfiles_proteger_admin()         from public, anon, authenticated;
revoke execute on function public.cuentas_proteger_ultima_lectura() from public, anon, authenticated;
revoke execute on function public.tocar_updated_at()                from public, anon, authenticated;

revoke execute on function public.es_admin()           from public, anon;
revoke execute on function public.es_operador_activo() from public, anon;

alter function public.tocar_updated_at() set search_path = '';
