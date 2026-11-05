-- Registro manual de cambios por campaña (05/11/2026).
--
-- Las reglas de Marketing ("escalar +20% si el último cambio fue hace 72 h o
-- más", "en espera, no tocar") necesitan saber cuándo se tocó cada campaña.
-- Meta lo da su registro de actividad; TikTok (que llega por Make) no trae
-- nada, así que el equipo lo anota a mano aquí. También se anotan los
-- lanzamientos de TikTok para el límite de 2 productos por día.
--
-- Solo el servidor la lee y escribe (service role): RLS sin políticas.

create table if not exists public.marketing_campaign_changes (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  platform text not null check (platform in ('meta','tiktok')),
  account_id text not null check (account_id ~ '^[0-9]{1,40}$'),
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,40}$'),
  campaign_name text not null default '' check (length(campaign_name) <= 300),
  product_key text check (product_key is null or length(product_key) between 5 and 300),
  kind text not null check (kind in ('presupuesto','puja','creativo','estado','lanzamiento','otro')),
  detail text not null default '' check (length(detail) <= 200),
  changed_at timestamptz not null,
  created_by text not null check (length(created_by) <= 200),
  created_at timestamptz not null default now()
);

create index if not exists marketing_campaign_changes_recent
  on public.marketing_campaign_changes (store_id, changed_at desc);

alter table public.marketing_campaign_changes enable row level security;
revoke all on public.marketing_campaign_changes from public, anon, authenticated;
grant select, insert, update, delete on public.marketing_campaign_changes to service_role;

comment on table public.marketing_campaign_changes is 'Cambios de presupuesto, puja, creativo, estado o lanzamiento anotados a mano por campaña; acceso solo servidor con sesión Kairo y permiso de Marketing.';
