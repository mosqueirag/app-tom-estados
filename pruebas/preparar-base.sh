P=/home/claude/pgtest; S=/mnt/project-files/app-tom-estados/supabase
psql -h $P -p 54329 -U postgres -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='e2e' and pid<>pg_backend_pid()" >/dev/null
psql -h $P -p 54329 -U postgres -q -c 'drop database if exists e2e' -c 'create database e2e'
( echo '\set ON_ERROR_STOP 1'; cat $S/tests/00_simular_supabase.sql $S/migrations/*.sql $S/seed.sql ) | psql -h $P -p 54329 -U postgres -d e2e -q 2>&1 | grep -v NOTICE
psql -h $P -p 54329 -U postgres -d e2e -q <<'SQL'
grant anon, authenticated to authenticator;
insert into auth.users (id,email,raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001','admin@x.com','{"nombre":"Guille Admin"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','jperez@usuarios.lecturas.app','{"nombre":"Juan Pérez","usuario":"jperez"}'),
 ('bbbbbbbb-0000-0000-0000-000000000003','mgomez@usuarios.lecturas.app','{"nombre":"María Gómez","usuario":"mgomez"}');
update perfiles set rol='admin' where email='admin@x.com';
update perfiles set activo=true;
SQL
pkill -x postgrest; while pgrep -x postgrest >/dev/null; do node -e "setTimeout(()=>{},200)"; done; cd /home/claude/pgrst && (./postgrest pgrst.conf > pgrst.log 2>&1 &); sleep 0
for i in $(seq 1 20); do curl -s -o /dev/null localhost:3000 && break; node -e "setTimeout(()=>{},300)"; done
