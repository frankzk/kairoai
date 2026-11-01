-- Kairo uses its signed cookie, not Supabase Auth. Only its server service role
-- can access presence; anon/authenticated never receive these records.
create table public.lead_presence (
  user_id bigint not null references public.kairo_users(id) on delete cascade,
  store_id bigint not null references public.stores(id) on delete cascade,
  last_activity_at timestamptz,
  last_seen_at timestamptz not null,
  primary key (user_id, store_id)
);
create table public.lead_presence_tabs (
  user_id bigint not null references public.kairo_users(id) on delete cascade,
  store_id bigint not null references public.stores(id) on delete cascade,
  tab_id uuid not null,
  sequence integer not null check (sequence > 0),
  last_seen_at timestamptz not null,
  last_activity_at timestamptz,
  visible boolean not null,
  closed boolean not null,
  primary key (user_id, store_id, tab_id)
);
create index lead_presence_store_idx on public.lead_presence (store_id);
create index lead_presence_tabs_store_seen_idx on public.lead_presence_tabs (store_id, last_seen_at);
alter table public.lead_presence enable row level security;
alter table public.lead_presence_tabs enable row level security;
revoke all on public.lead_presence, public.lead_presence_tabs from public, anon, authenticated;
grant select, insert, update, delete on public.lead_presence, public.lead_presence_tabs to service_role;

create function public.record_lead_presence(
  p_user_id bigint, p_store_id bigint, p_tab_id uuid, p_sequence integer,
  p_visible boolean, p_closed boolean, p_activity_age_ms integer
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  stamp timestamptz := clock_timestamp();
  activity_stamp timestamptz;
  accepted integer;
begin
  if p_sequence is null or p_sequence < 1 or p_visible is null or p_closed is null
    or (p_activity_age_ms is not null and (p_activity_age_ms < 0 or p_activity_age_ms > 43200000)) then
    raise exception 'Invalid presence signal';
  end if;
  if not exists (
    select 1 from public.kairo_users u join public.stores s on s.id = p_store_id
    where u.id = p_user_id and u.activo and s.code = any(u.tiendas)
      and u.permisos && array['leads','leads_equipo']::text[]
  ) then raise exception 'Presence not permitted'; end if;
  activity_stamp := case when p_activity_age_ms is null then null
    else stamp - p_activity_age_ms * interval '1 millisecond' end;

  -- Only this user's expired tab leases are removed. Their most recent activity
  -- remains in lead_presence even after every tab has closed.
  delete from public.lead_presence_tabs where user_id = p_user_id
    and last_seen_at < stamp - interval '1 day';
  insert into public.lead_presence_tabs as t
    (user_id, store_id, tab_id, sequence, last_seen_at, last_activity_at, visible, closed)
  values (p_user_id, p_store_id, p_tab_id, p_sequence, stamp, activity_stamp, p_visible and not p_closed, p_closed)
  on conflict (user_id, store_id, tab_id) do update set
    sequence = excluded.sequence,
    last_seen_at = excluded.last_seen_at,
    last_activity_at = greatest(t.last_activity_at, excluded.last_activity_at),
    visible = excluded.visible,
    closed = excluded.closed
  where excluded.sequence > t.sequence;
  get diagnostics accepted = row_count;
  -- A late heartbeat must not resurrect a tab after its later pagehide signal.
  if accepted = 0 then return; end if;
  insert into public.lead_presence as p (user_id, store_id, last_seen_at, last_activity_at)
  values (p_user_id, p_store_id, stamp, activity_stamp)
  on conflict (user_id, store_id) do update set
    last_seen_at = greatest(p.last_seen_at, excluded.last_seen_at),
    last_activity_at = greatest(p.last_activity_at, excluded.last_activity_at);
end;
$$;
revoke all on function public.record_lead_presence(bigint,bigint,uuid,integer,boolean,boolean,integer) from public, anon, authenticated;
grant execute on function public.record_lead_presence(bigint,bigint,uuid,integer,boolean,boolean,integer) to service_role;

comment on table public.lead_presence is 'Last observed Leads activity per actual signed-in Kairo user and store. No chat or input content.';
comment on table public.lead_presence_tabs is 'Server-timed per-tab leases; delayed signals are ignored by sequence. Service-role only.';
