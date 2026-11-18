-- Telefonía por tienda: con qué proveedor llaman las asesoras (Zadarma o
-- Telnyx) y cuál se usa de respaldo si el principal no conecta (el otro, o
-- ninguno). Se elige en Configuración › Telefonía.
--
-- Sin fila para una tienda rige la variable TELEFONIA de Vercel (lo de antes)
-- y no hay respaldo.
--
-- Solo service role (RLS activa sin políticas). Re-ejecutable.

create table if not exists public.telefonia_tiendas (
  store_id    bigint primary key references public.stores(id) on delete cascade,
  principal   text not null check (principal in ('zadarma', 'telnyx')),
  respaldo    text check (respaldo is null or (respaldo in ('zadarma', 'telnyx') and respaldo <> principal)),
  updated_by  text check (updated_by is null or length(updated_by) <= 200),
  updated_at  timestamptz not null default now()
);

alter table public.telefonia_tiendas enable row level security;
