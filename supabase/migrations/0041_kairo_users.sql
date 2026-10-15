-- Accesos personales: cada persona con su usuario, su contraseña y sus permisos.
--
-- Hasta aca todo el equipo entraba con UNA contraseña compartida y cada
-- asesora decia quien era eligiendo su nombre en una lista. Cualquiera podia
-- ver Finanzas o registrar gestiones a nombre de otra.
--
-- - permisos: lo que de verdad se aplica (pantallas y poderes). Los roles son
--   plantillas que la pantalla de usuarios usa para precargar permisos; se
--   guardan para saber de donde salio cada acceso.
-- - tiendas: codigos de tienda ("mireva-cr", "mireva-hn") que puede trabajar.
-- - staff_id: la asesora de la planilla que ES esta persona. Sus gestiones,
--   mensajes y llamadas quedan a ese nombre sin poder elegir otro.
-- - session_version: subirla corta todas las sesiones abiertas de la persona
--   (al desactivarla o resetearle la contraseña).
-- - password_hash: scrypt con sal propia. Nunca se guarda la contraseña.
--
-- RLS activa SIN politicas: solo la lee el servidor (service role).

create table if not exists public.kairo_users (
  id bigserial primary key,
  username text not null,
  nombre text not null,
  password_hash text not null,
  roles text[] not null default '{}',
  permisos text[] not null default '{}',
  tiendas text[] not null default '{}',
  staff_id bigint references public.payroll_staff(id) on delete set null,
  activo boolean not null default true,
  debe_cambiar_clave boolean not null default true,
  session_version integer not null default 1,
  intentos_fallidos integer not null default 0,
  bloqueado_hasta timestamptz,
  ultimo_ingreso timestamptz,
  creado_por text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kairo_users_username_formato check (username ~ '^[a-z0-9._-]{3,32}$')
);

create unique index if not exists kairo_users_username_key on public.kairo_users (username);
-- Una asesora de la planilla = una sola persona con acceso.
create unique index if not exists kairo_users_staff_key on public.kairo_users (staff_id) where staff_id is not null;

alter table public.kairo_users enable row level security;

-- Quien hizo que con los accesos: altas, cambios de permisos, desactivaciones,
-- reseteos e ingresos. Para poder responder "¿quien le dio acceso a Finanzas?".
create table if not exists public.kairo_user_events (
  id bigserial primary key,
  user_id bigint references public.kairo_users(id) on delete cascade,
  actor text not null default '',
  accion text not null,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kairo_user_events_user_idx on public.kairo_user_events (user_id, created_at desc);

alter table public.kairo_user_events enable row level security;
