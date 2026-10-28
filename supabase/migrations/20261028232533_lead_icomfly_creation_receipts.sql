create table public.lead_icomfly_receipts (
 request_id uuid primary key,
 store_id bigint not null,
 lead_id bigint not null,
 advisor_id bigint not null,
 icomfly_id text,
 confirmed_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index lead_icomfly_receipts_open_lead on public.lead_icomfly_receipts(store_id, lead_id) where confirmed_at is null;
alter table public.lead_icomfly_receipts enable row level security;
revoke all on public.lead_icomfly_receipts from anon, authenticated;
grant all on public.lead_icomfly_receipts to service_role;
