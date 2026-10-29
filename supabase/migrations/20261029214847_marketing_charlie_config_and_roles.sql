create table public.marketing_charlie_config (
 store_id bigint primary key references public.stores(id),
 crc_per_usd numeric check (crc_per_usd > 0 and crc_per_usd <= 100000),
 rate_date date,
 hero_product_keys text[] not null default '{}',
 updated_by text not null,
 updated_at timestamptz not null default now(),
 check ((crc_per_usd is null and rate_date is null) or (crc_per_usd is not null and rate_date is not null)),
 check (cardinality(hero_product_keys) <= 100)
);
create table public.marketing_adset_roles (
 store_id bigint not null references public.stores(id),
 account_id text not null check (account_id ~ '^[0-9]{1,40}$'),
 adset_id text not null check (adset_id ~ '^[0-9]{1,40}$'),
 role text not null check (role in ('control','testing','other')),
 updated_by text not null,
 updated_at timestamptz not null default now(),
 primary key (store_id,account_id,adset_id)
);
alter table public.marketing_charlie_config enable row level security;
alter table public.marketing_adset_roles enable row level security;
revoke all on public.marketing_charlie_config,public.marketing_adset_roles from public,anon,authenticated;
grant select,insert,update,delete on public.marketing_charlie_config,public.marketing_adset_roles to service_role;
comment on table public.marketing_charlie_config is 'Configuración de referencia USD y Hero Offer para cálculos potenciales, solo servidor Kairo.';
comment on table public.marketing_adset_roles is 'Correcciones internas de clasificación Control/Testing; no modifica los anuncios ni conjuntos de Meta.';
