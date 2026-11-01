-- Daily connection evidence, separate from the user's latest connection. A
-- newer heartbeat must not erase that they visited Leads in an earlier period.
create table public.lead_presence_days (
  user_id bigint not null references public.kairo_users(id) on delete cascade,
  store_id bigint not null references public.stores(id) on delete cascade,
  presence_day date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_activity_at timestamptz,
  primary key (user_id, store_id, presence_day)
);
create index lead_presence_days_period_idx on public.lead_presence_days (store_id, presence_day);
alter table public.lead_presence_days enable row level security;
revoke all on public.lead_presence_days from public, anon, authenticated;
grant select, insert, update, delete on public.lead_presence_days to service_role;

create function public.capture_lead_presence_day() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.closed then return new; end if;
  insert into public.lead_presence_days as d
    (user_id,store_id,presence_day,first_seen_at,last_seen_at,last_activity_at)
  values (new.user_id,new.store_id,(new.last_seen_at at time zone 'America/Costa_Rica')::date,
    new.last_seen_at,new.last_seen_at,new.last_activity_at)
  on conflict (user_id,store_id,presence_day) do update set
    first_seen_at = least(d.first_seen_at,excluded.first_seen_at),
    last_seen_at = greatest(d.last_seen_at,excluded.last_seen_at),
    last_activity_at = greatest(d.last_activity_at,excluded.last_activity_at);
  return new;
end;
$$;
revoke all on function public.capture_lead_presence_day() from public, anon, authenticated;
grant execute on function public.capture_lead_presence_day() to service_role;
create trigger lead_presence_day_capture after insert or update on public.lead_presence_tabs
  for each row execute function public.capture_lead_presence_day();

-- Import only observed timestamps. Do not infer earlier days or session lengths.
insert into public.lead_presence_days (user_id,store_id,presence_day,first_seen_at,last_seen_at,last_activity_at)
select user_id,store_id,(last_seen_at at time zone 'America/Costa_Rica')::date,last_seen_at,last_seen_at,last_activity_at
from public.lead_presence;

create function public.lead_presence_in_period(p_store_id bigint,p_from timestamptz,p_to timestamptz)
returns table(user_id bigint,period_last_seen_at timestamptz,period_last_activity_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select d.user_id,max(d.last_seen_at),
    max(d.last_activity_at) filter (where d.last_activity_at >= p_from and d.last_activity_at < p_to)
  from public.lead_presence_days d
  where d.store_id = p_store_id and p_from < p_to
    and d.presence_day >= (p_from at time zone 'America/Costa_Rica')::date
    and d.presence_day <= (p_to at time zone 'America/Costa_Rica')::date
    and d.last_seen_at >= p_from and d.first_seen_at < p_to
  group by d.user_id;
$$;
revoke all on function public.lead_presence_in_period(bigint,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.lead_presence_in_period(bigint,timestamptz,timestamptz) to service_role;
