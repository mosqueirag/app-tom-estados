-- =====================================================================
-- 01 · Tablas e índices
-- App de toma de lecturas de medidores
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- perfiles: un registro por usuario de auth.users
-- ---------------------------------------------------------------------
create table public.perfiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  email       text,
  usuario     text unique,                 -- nombre de usuario opcional (login sin email real)
  rol         text not null default 'operador' check (rol in ('admin', 'operador')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.perfiles is 'Datos y rol de cada usuario. Se crea automáticamente al registrarse en auth.users.';

-- ---------------------------------------------------------------------
-- cuentas: padrón de cuentas / medidores
-- ---------------------------------------------------------------------
create table public.cuentas (
  id                    uuid primary key default gen_random_uuid(),
  numero_cuenta         text not null unique check (btrim(numero_cuenta) <> ''),
  titular               text not null default '',
  direccion             text not null default '',
  medidor               text not null default '',
  ultima_lectura        numeric(14, 3) check (ultima_lectura >= 0),
  fecha_ultima_lectura  date,
  ultimo_consumo        numeric(14, 3),
  activa                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.cuentas.ultima_lectura is 'Solo cambia al cerrar un período (cerrar_periodo) o por edición del admin.';

create index cuentas_activa_idx    on public.cuentas (activa);
create index cuentas_medidor_idx   on public.cuentas (medidor);
create index cuentas_titular_trgm  on public.cuentas using gin (titular extensions.gin_trgm_ops);
create index cuentas_direccion_trgm on public.cuentas using gin (direccion extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- periodos: solo uno activo a la vez
-- ---------------------------------------------------------------------
create table public.periodos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (btrim(nombre) <> ''),
  fecha_inicio  date not null default current_date,
  fecha_cierre  date,
  activo        boolean not null default true,
  cerrado_por   uuid references public.perfiles (id),
  created_at    timestamptz not null default now(),
  check (not (activo and fecha_cierre is not null))
);

-- Índice único parcial: como máximo una fila con activo = true
create unique index periodos_un_solo_activo on public.periodos (activo) where activo;

-- ---------------------------------------------------------------------
-- configuracion: una única fila con parámetros que ajusta el admin
-- ---------------------------------------------------------------------
create table public.configuracion (
  id                      int primary key default 1 check (id = 1),
  umbral_consumo_anomalo  numeric(6, 2) not null default 3 check (umbral_consumo_anomalo > 0),
  updated_at              timestamptz not null default now()
);

comment on column public.configuracion.umbral_consumo_anomalo is
  'Se alerta si el consumo supera N veces el ultimo_consumo de la cuenta (por defecto 3).';

insert into public.configuracion (id) values (1);

-- ---------------------------------------------------------------------
-- lecturas: una por cuenta por período
-- El id lo genera el CELULAR (uuid) para que reintentar la sincronización
-- nunca duplique.
-- ---------------------------------------------------------------------
create table public.lecturas (
  id                uuid primary key,              -- generado en el cliente
  cuenta_id         uuid not null references public.cuentas (id),
  periodo_id        uuid not null references public.periodos (id),
  operador_id       uuid not null references public.perfiles (id),
  lectura_anterior  numeric(14, 3),                -- copia de cuentas.ultima_lectura al leer
  lectura_actual    numeric(14, 3),
  consumo           numeric(14, 3) generated always as (lectura_actual - lectura_anterior) stored,
  observacion       text,
  sin_lectura       boolean not null default false,
  fecha_lectura     timestamptz not null,          -- hora del celular
  sincronizado_at   timestamptz not null default now(), -- hora del servidor
  corregida_por     uuid references public.perfiles (id),
  corregida_at      timestamptz,
  constraint lecturas_una_por_cuenta_periodo unique (cuenta_id, periodo_id),
  constraint lecturas_valor_valido check (
    (sin_lectura and lectura_actual is null)
    or (not sin_lectura and lectura_actual is not null and lectura_actual >= 0)
  )
);

create index lecturas_periodo_idx  on public.lecturas (periodo_id);
create index lecturas_operador_idx on public.lecturas (operador_id, periodo_id);
create index lecturas_cuenta_idx   on public.lecturas (cuenta_id);

-- ---------------------------------------------------------------------
-- lecturas_correcciones: historial de cambios hechos por el admin
-- ---------------------------------------------------------------------
create table public.lecturas_correcciones (
  id                        bigint generated always as identity primary key,
  lectura_id                uuid not null references public.lecturas (id) on delete cascade,
  corregida_por             uuid references public.perfiles (id),
  corregida_at              timestamptz not null default now(),
  lectura_actual_anterior   numeric(14, 3),
  lectura_actual_nueva      numeric(14, 3),
  sin_lectura_anterior      boolean,
  sin_lectura_nueva         boolean,
  observacion_anterior      text,
  observacion_nueva         text
);

create index lecturas_correcciones_lectura_idx on public.lecturas_correcciones (lectura_id);

-- ---------------------------------------------------------------------
-- lecturas_conflictos: lecturas que el servidor no pudo aceptar. No se
-- pierde el dato: queda acá para que la vean el operador y el admin.
--   motivo 'ya_leida'        → otro operador ya leyó la cuenta en el período
--   motivo 'periodo_cerrado' → se sincronizó después de cerrar el período
--   motivo 'reemplazada'     → era la lectura aceptada y el admin la reemplazó
--                              por la del conflicto (queda como historial)
-- ---------------------------------------------------------------------
create table public.lecturas_conflictos (
  id                    uuid primary key,          -- mismo uuid que generó el celular
  cuenta_id             uuid not null references public.cuentas (id),
  periodo_id            uuid not null references public.periodos (id),
  operador_id           uuid not null references public.perfiles (id),
  lectura_actual        numeric(14, 3),
  observacion           text,
  sin_lectura           boolean not null default false,
  fecha_lectura         timestamptz not null,
  motivo                text not null default 'ya_leida' check (motivo in ('ya_leida', 'periodo_cerrado', 'reemplazada')),
  lectura_existente_id  uuid references public.lecturas (id) on delete set null,
  created_at            timestamptz not null default now(),
  resuelto              boolean not null default false,
  resolucion            text check (resolucion in ('descartada', 'reemplaza')),
  resuelto_por          uuid references public.perfiles (id),
  resuelto_at           timestamptz
);

create index lecturas_conflictos_periodo_idx  on public.lecturas_conflictos (periodo_id) where not resuelto;
create index lecturas_conflictos_operador_idx on public.lecturas_conflictos (operador_id);
