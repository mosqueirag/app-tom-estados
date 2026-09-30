-- =====================================================================
-- 13 · Permisos de mensajes y auditoría
--   Las tablas nuevas no deben estar expuestas a usuarios sin sesión, y la
--   auditoría solo se escribe desde el trigger (nadie la edita a mano).
-- =====================================================================
revoke all on public.mensajes, public.auditoria from anon;
grant select, insert, update, delete on public.mensajes to authenticated;
revoke all on public.auditoria from authenticated;
grant select on public.auditoria to authenticated;
