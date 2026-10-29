create role anon; create role authenticated; create role service_role bypassrls;
create table public.stores(id bigint primary key,code text,active boolean);
insert into public.stores values(5,'kenku-it',true),(1,'other',true),(6,'kenku-it',false);
create table public.reconciliation_test_orders(
 store_id bigint,source text,source_id text,order_number text,created_at timestamptz default now(),
 payload jsonb default '{"total_price":"39.00","currency":"EUR","financial_status":"pending"}',
 status text,version integer default 0,synced_version integer default 0,last_error text,
 management_note text default '',courier text default '',tracking_number text default '',
 managed_at timestamptz,source_updated_at timestamptz default now(),search_text text default '',
 primary key(store_id,source,source_id)
);
create view public.italia_orders with(security_invoker=true) as
 select o.* from public.reconciliation_test_orders o join public.stores s on s.id=o.store_id where s.code='kenku-it' and s.active;
create table public.italia_shopify_index(store_id bigint,shopify_id text,order_number text,primary key(store_id,shopify_id));
create table public.woo_orders(store_id bigint,id bigint,order_number text,primary key(store_id,id));
create table public.italia_shopify_management(store_id bigint,shopify_id text,status text,primary key(store_id,shopify_id));
create table public.italia_elogy_records(store_id bigint,resource text,record_id text,order_ref text,data jsonb,observed_at timestamptz default now(),primary key(store_id,resource,record_id));
alter table public.reconciliation_test_orders enable row level security;
alter table public.italia_shopify_index enable row level security;
alter table public.woo_orders enable row level security;
alter table public.italia_shopify_management enable row level security;
alter table public.italia_elogy_records enable row level security;
revoke all on all tables in schema public from anon,authenticated,public;
grant select on all tables in schema public to service_role;
