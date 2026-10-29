create table public.marketing_campaign_products (
  store_id bigint not null references public.stores(id),
  platform text not null check (platform in ('meta','tiktok')),
  account_id text not null check (account_id ~ '^[0-9]{1,40}$'),
  campaign_id text not null check (campaign_id ~ '^[0-9]{1,40}$'),
  product_key text not null check (length(product_key) between 5 and 300),
  product_name text not null check (length(product_name) between 1 and 200),
  sku text not null default '' check (length(sku) <= 100),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (store_id,platform,account_id,campaign_id)
);
create table public.marketing_product_plans (
  store_id bigint not null references public.stores(id),
  product_key text not null check (length(product_key) between 5 and 300),
  product_name text not null check (length(product_name) between 1 and 200),
  sku text not null default '' check (length(sku) <= 100),
  priority boolean not null default false,
  supplier text not null default '' check (length(supplier) <= 120),
  lead_days integer check (lead_days between 0 and 365),
  cover_days integer check (cover_days between 1 and 365),
  incoming_units integer not null default 0 check (incoming_units between 0 and 10000000),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (store_id,product_key)
);
alter table public.marketing_campaign_products enable row level security;
alter table public.marketing_product_plans enable row level security;
revoke all on public.marketing_campaign_products, public.marketing_product_plans from public, anon, authenticated;
grant select,insert,update,delete on public.marketing_campaign_products, public.marketing_product_plans to service_role;
comment on table public.marketing_campaign_products is 'Asignación interna de campañas a productos; acceso solo servidor con sesión Kairo y tienda autorizada.';
comment on table public.marketing_product_plans is 'Prioridad y parámetros manuales de reposición; no modifica anuncios ni genera compras a proveedores.';
