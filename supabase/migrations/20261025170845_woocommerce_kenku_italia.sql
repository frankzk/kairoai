-- Separate origin and storage: never impersonate a Shopify order.
create table public.woo_orders (
  id bigint generated always as identity primary key,
  store_id bigint not null references public.stores(id),
  woo_id bigint not null check (woo_id > 0),
  order_number text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','confirmed','dispatched','delivered','cancelled')),
  version integer not null default 0,
  synced_version integer not null default 0,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, woo_id)
);
create index woo_orders_list on public.woo_orders(store_id, created_at desc, id desc);
create index woo_orders_outbox on public.woo_orders(next_attempt_at) where version > synced_version;
create table public.woo_order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.woo_orders(id),
  request_id uuid not null,
  status text not null,
  version integer not null,
  actor text not null,
  created_at timestamptz not null default now(),
  unique(order_id, request_id)
);
alter table public.woo_orders enable row level security;
alter table public.woo_order_events enable row level security;
revoke all on public.woo_orders, public.woo_order_events from public, anon, authenticated;
grant all on public.woo_orders, public.woo_order_events to service_role;
grant usage, select on sequence public.woo_orders_id_seq, public.woo_order_events_id_seq to service_role;

create function public.woo_receive_order(p_store bigint, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.woo_orders; inserted_id bigint;
begin
  if not exists(select 1 from public.stores where id=p_store and code='kenku-it' and active) then
    raise exception 'Invalid store';
  end if;
  insert into public.woo_orders(store_id,woo_id,order_number,payload)
    values(p_store,(p_payload->>'woo_id')::bigint,p_payload->>'order_number',p_payload)
    on conflict(store_id,woo_id) do nothing returning id into inserted_id;
  select * into r from public.woo_orders where store_id=p_store and woo_id=(p_payload->>'woo_id')::bigint;
  -- Duplicate deliveries never overwrite corrections or advance/rewind state.
  return jsonb_build_object('id',r.id,'duplicate',inserted_id is null);
end $$;

create function public.woo_change_status(p_store bigint,p_id bigint,p_expected integer,p_status text,p_request uuid,p_actor text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.woo_orders; allowed text[];
begin
  select * into r from public.woo_orders where id=p_id and store_id=p_store for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if exists(select 1 from public.woo_order_events where order_id=p_id and request_id=p_request) then
    return jsonb_build_object('ok',true,'duplicate',true);
  end if;
  if r.version<>p_expected or r.version<>r.synced_version or r.lease_until>now() then
    return jsonb_build_object('error','conflict');
  end if;
  allowed := case r.status when 'pending' then array['confirmed','cancelled']
    when 'confirmed' then array['dispatched','cancelled'] when 'dispatched' then array['delivered','cancelled'] else array[]::text[] end;
  if not (p_status=any(allowed)) then return jsonb_build_object('error','invalid_transition'); end if;
  update public.woo_orders set status=p_status,version=version+1,attempts=0,next_attempt_at=now(),last_error=null,updated_at=now() where id=p_id;
  insert into public.woo_order_events(order_id,request_id,status,version,actor) values(p_id,p_request,p_status,r.version+1,p_actor);
  return jsonb_build_object('ok',true,'version',r.version+1);
end $$;

create function public.woo_claim_status()
returns setof public.woo_orders language sql security invoker set search_path = '' as $$
  update public.woo_orders set lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
  where id=(select w.id from public.woo_orders w join public.stores s on s.id=w.store_id
    where s.code='kenku-it' and s.active and w.version>w.synced_version and w.next_attempt_at<=now()
      and (w.lease_until is null or w.lease_until<now()) order by w.next_attempt_at,w.id
    for update of w skip locked limit 1) returning *;
$$;

create function public.woo_finish_status(p_id bigint,p_lease uuid,p_error text)
returns void language sql security invoker set search_path = '' as $$
  update public.woo_orders set
    synced_version=case when p_error is null then version else synced_version end,
    attempts=case when p_error is null then 0 else attempts+1 end,
    next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::integer),
    last_error=left(p_error,200),lease_token=null,lease_until=null,updated_at=now()
  where id=p_id and lease_token=p_lease;
$$;

revoke all on function public.woo_receive_order(bigint,jsonb), public.woo_change_status(bigint,bigint,integer,text,uuid,text), public.woo_claim_status(), public.woo_finish_status(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.woo_receive_order(bigint,jsonb), public.woo_change_status(bigint,bigint,integer,text,uuid,text), public.woo_claim_status(), public.woo_finish_status(bigint,uuid,text) to service_role;
update public.stores set active=true,updated_at=now() where code='kenku-it';
