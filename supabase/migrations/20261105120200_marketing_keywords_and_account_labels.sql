-- Palabras clave de campaña y nombres cortos de cuentas (05/11/2026).
--
-- marketing_campaign_keywords: si el nombre de una campaña contiene la palabra
-- (por ejemplo "neocell"), Marketing le asigna el producto automáticamente.
-- La palabra se guarda normalizada: minúsculas, sin tildes, palabras
-- separadas por un espacio.
--
-- marketing_ad_account_labels: nombre corto de cada cuenta publicitaria
-- (Madre, CR2…CR5). "Madre" no se puede deducir del nombre de la cuenta.
--
-- Solo el servidor las lee y escribe (service role): RLS sin políticas.

create table if not exists public.marketing_campaign_keywords (
  store_id bigint not null references public.stores(id),
  keyword text not null check (char_length(keyword) between 3 and 60 and keyword ~ '^[a-z0-9]+( [a-z0-9]+)*$'),
  family_key text not null check (length(family_key) between 5 and 300),
  product_name text not null check (length(product_name) between 1 and 200),
  updated_by text not null check (length(updated_by) <= 200),
  updated_at timestamptz not null default now(),
  primary key (store_id, keyword)
);

create table if not exists public.marketing_ad_account_labels (
  store_id bigint not null references public.stores(id),
  platform text not null check (platform in ('meta','tiktok')),
  account_id text not null check (account_id ~ '^[0-9]{1,40}$'),
  label text not null check (char_length(label) between 1 and 20),
  updated_by text not null check (length(updated_by) <= 200),
  updated_at timestamptz not null default now(),
  primary key (store_id, platform, account_id)
);

alter table public.marketing_campaign_keywords enable row level security;
alter table public.marketing_ad_account_labels enable row level security;
revoke all on public.marketing_campaign_keywords, public.marketing_ad_account_labels from public, anon, authenticated;
grant select, insert, update, delete on public.marketing_campaign_keywords, public.marketing_ad_account_labels to service_role;

comment on table public.marketing_campaign_keywords is 'Reglas del equipo: palabra del nombre de campaña → producto agrupado. Asignación automática corregible; acceso solo servidor.';
comment on table public.marketing_ad_account_labels is 'Nombre corto de cada cuenta publicitaria de Costa Rica (Madre, CR2…CR5) para la tabla de acciones; acceso solo servidor.';
