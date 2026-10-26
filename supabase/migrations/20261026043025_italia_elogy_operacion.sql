-- Datos de Elogy para Italia: ningún acceso anónimo ni escritura desde el navegador.
create table public.italia_elogy_records (
 store_id bigint not null references public.stores(id),
 resource text not null check(resource in ('orders','shipments','collected','costs')),
 record_id text not null check(length(record_id) between 1 and 160),
 order_ref text not null default '', order_id text not null default '',
 occurred_at timestamptz, source_updated_at timestamptz,
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<200000),
 observed_at timestamptz not null default now(),
 primary key(store_id,resource,record_id)
);
create index italia_elogy_record_date on public.italia_elogy_records(store_id,resource,occurred_at desc);
create index italia_elogy_record_order on public.italia_elogy_records(store_id,order_id);
create table public.italia_elogy_sync (
 store_id bigint not null references public.stores(id), resource text not null,
 next_offset integer not null default 0 check(next_offset>=0), total integer,
 last_page_hash text, lease uuid, lease_until timestamptz,
 last_attempt_at timestamptz,last_ok_at timestamptz,completed_at timestamptz,
 last_error text,cycles integer not null default 0,
 primary key(store_id,resource),check(resource in ('orders','shipments','collected','costs'))
);
create table public.italia_elogy_payouts (
 id bigint generated always as identity primary key,store_id bigint not null references public.stores(id),
 reference text not null check(length(reference) between 1 and 120),
 statement_date date not null,expected_cents bigint not null check(expected_cents>=0),
 received_cents bigint check(received_cents>=0),received_at date,
 note text not null default '',version integer not null default 1,
 updated_at timestamptz not null default now(),unique(store_id,reference),
 check((received_cents is null)=(received_at is null))
);
create table public.italia_finance_audit (
 id bigint generated always as identity primary key,store_id bigint not null references public.stores(id),
 request_id uuid not null,action text not null,body jsonb not null,
 actor text not null,before_data jsonb,after_data jsonb not null,created_at timestamptz not null default now(),
 unique(store_id,request_id)
);
create index italia_finance_audit_store_date on public.italia_finance_audit(store_id,created_at desc);
alter table public.italia_elogy_records enable row level security;
alter table public.italia_elogy_sync enable row level security;
alter table public.italia_elogy_payouts enable row level security;
alter table public.italia_finance_audit enable row level security;
revoke all on public.italia_elogy_records,public.italia_elogy_sync,public.italia_elogy_payouts,public.italia_finance_audit from public,anon,authenticated;
grant all on public.italia_elogy_records,public.italia_elogy_sync,public.italia_elogy_payouts,public.italia_finance_audit to service_role;
grant usage,select on sequence public.italia_elogy_payouts_id_seq,public.italia_finance_audit_id_seq to service_role;

create function public.italia_elogy_claim(p_store bigint,p_resource text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.italia_elogy_sync; token uuid;
begin
 if not exists(select 1 from public.stores where id=p_store and code='kenku-it' and active) then raise exception 'wrong_store'; end if;
 insert into public.italia_elogy_sync(store_id,resource) values(p_store,p_resource) on conflict do nothing;
 select * into r from public.italia_elogy_sync where store_id=p_store and resource=p_resource for update;
 if r.lease_until>now() then return jsonb_build_object('busy',true); end if;
 token=gen_random_uuid();
 update public.italia_elogy_sync set lease=token,lease_until=now()+interval '4 minutes',last_attempt_at=now() where store_id=p_store and resource=p_resource;
 return jsonb_build_object('lease',token,'offset',r.next_offset,'last_hash',r.last_page_hash);
end $$;

create function public.italia_elogy_finish(p_store bigint,p_resource text,p_lease uuid,p_rows jsonb,p_next integer,p_total integer,p_complete boolean,p_hash text,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.italia_elogy_sync; item jsonb;
begin
 if not exists(select 1 from public.stores where id=p_store and code='kenku-it' and active) then raise exception 'wrong_store'; end if;
 select * into r from public.italia_elogy_sync where store_id=p_store and resource=p_resource for update;
 if not found or r.lease is distinct from p_lease or r.lease_until<now() then return false; end if;
 if p_error is not null then
  update public.italia_elogy_sync set lease=null,lease_until=null,last_error=left(p_error,100) where store_id=p_store and resource=p_resource;
  return true;
 end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 or p_next<r.next_offset or p_total<0 then raise exception 'invalid_page'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  insert into public.italia_elogy_records(store_id,resource,record_id,order_ref,order_id,occurred_at,source_updated_at,data)
  values(p_store,p_resource,item->>'id',coalesce(item->>'ref',''),coalesce(item->>'order_id',''),nullif(item->>'occurred_at','')::timestamptz,nullif(item->>'source_updated_at','')::timestamptz,item)
  on conflict(store_id,resource,record_id) do update set
    order_ref=excluded.order_ref,order_id=excluded.order_id,occurred_at=excluded.occurred_at,
    source_updated_at=excluded.source_updated_at,data=excluded.data,observed_at=now()
  where public.italia_elogy_records.source_updated_at is null or excluded.source_updated_at>=public.italia_elogy_records.source_updated_at;
 end loop;
 update public.italia_elogy_sync set next_offset=case when p_complete then 0 else p_next end,total=p_total,
  last_page_hash=case when p_complete then null else p_hash end,lease=null,lease_until=null,
  last_ok_at=now(),last_error=null,completed_at=case when p_complete then now() else completed_at end,
  cycles=cycles+case when p_complete then 1 else 0 end where store_id=p_store and resource=p_resource;
 return true;
end $$;

create function public.italia_finance_mutate(p_store bigint,p_action text,p_body jsonb,p_request uuid,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior public.italia_finance_audit; cost public.product_costs; expense public.business_expenses; payout public.italia_elogy_payouts;
 result jsonb; before_row jsonb;
begin
 if not exists(select 1 from public.stores where id=p_store and code='kenku-it' and active) then raise exception 'wrong_store'; end if;
 perform pg_advisory_xact_lock(hashtext('italia-finance:'||p_store::text));
 select * into prior from public.italia_finance_audit where store_id=p_store and request_id=p_request;
 if found then
  if prior.action<>p_action or prior.body<>p_body then return jsonb_build_object('error','request_reused'); end if;
  return jsonb_build_object('ok',true,'duplicate',true,'record',prior.after_data);
 end if;
 if p_action='cost' then
  if length(p_body->>'sku') not between 1 and 100 or (p_body->>'unit_cents')::bigint<0 or (p_body->>'packaging_cents')::bigint<0 then raise exception 'invalid_cost'; end if;
  select * into cost from public.product_costs where store_id=p_store and sku=lower(trim(p_body->>'sku')) order by id desc limit 1 for update;
  if found then
   if cost.updated_at is distinct from nullif(p_body->>'expected_updated_at','')::timestamptz then return jsonb_build_object('error','conflict'); end if;
   before_row=to_jsonb(cost);
   update public.product_costs set product_name=p_body->>'name',unit_cost=(p_body->>'unit_cents')::numeric/100,
    packaging_cost=(p_body->>'packaging_cents')::numeric/100,currency='EUR',effective_from=(p_body->>'effective_from')::date,active=true,updated_at=clock_timestamp()
    where id=cost.id and store_id=p_store returning * into cost;
  else
   if nullif(p_body->>'expected_updated_at','') is not null then return jsonb_build_object('error','conflict'); end if;
   insert into public.product_costs(store_id,sku,product_name,unit_cost,packaging_cost,currency,effective_from,active)
   values(p_store,lower(trim(p_body->>'sku')),p_body->>'name',(p_body->>'unit_cents')::numeric/100,(p_body->>'packaging_cents')::numeric/100,'EUR',(p_body->>'effective_from')::date,true) returning * into cost;
  end if;
  insert into public.product_cost_versions(store_id,sku,product_name,unit_cost,packaging_cost,currency,effective_from)
  values(p_store,cost.sku,cost.product_name,cost.unit_cost,cost.packaging_cost,'EUR',cost.effective_from);
  result=to_jsonb(cost);
 elsif p_action='expense' then
  if (p_body->>'amount_cents')::bigint<0 or length(p_body->>'description') not between 1 and 300 then raise exception 'invalid_expense'; end if;
  insert into public.business_expenses(store_id,type,expense_date,month,platform,category,description,amount,currency,notes)
  values(p_store,p_body->>'type',(p_body->>'date')::date,left(p_body->>'date',7),coalesce(p_body->>'platform',''),coalesce(p_body->>'category',''),p_body->>'description',(p_body->>'amount_cents')::numeric/100,'EUR',coalesce(p_body->>'note','')) returning * into expense;
  result=to_jsonb(expense);
 elsif p_action='payout' then
  if (p_body->>'expected_cents')::bigint<0 or length(p_body->>'reference') not between 1 and 120 then raise exception 'invalid_payout'; end if;
  if exists(select 1 from public.italia_elogy_payouts where store_id=p_store and reference=p_body->>'reference') then return jsonb_build_object('error','reference_exists'); end if;
  insert into public.italia_elogy_payouts(store_id,reference,statement_date,expected_cents,note)
  values(p_store,p_body->>'reference',(p_body->>'date')::date,(p_body->>'expected_cents')::bigint,coalesce(p_body->>'note','')) returning * into payout;
  result=to_jsonb(payout);
 elsif p_action='receipt' then
  select * into payout from public.italia_elogy_payouts where store_id=p_store and id=(p_body->>'id')::bigint for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if payout.version<>(p_body->>'version')::integer then return jsonb_build_object('error','conflict'); end if;
  if (p_body->>'received_cents')::bigint<0 then raise exception 'invalid_receipt'; end if;
  before_row=to_jsonb(payout);
  update public.italia_elogy_payouts set received_cents=(p_body->>'received_cents')::bigint,received_at=(p_body->>'date')::date,
    note=coalesce(p_body->>'note',''),version=version+1,updated_at=clock_timestamp() where store_id=p_store and id=payout.id returning * into payout;
  result=to_jsonb(payout);
 else raise exception 'invalid_action';
 end if;
 insert into public.italia_finance_audit(store_id,request_id,action,body,actor,before_data,after_data)
 values(p_store,p_request,p_action,p_body,left(p_actor,150),before_row,result);
 return jsonb_build_object('ok',true,'record',result);
end $$;
revoke all on function public.italia_elogy_claim(bigint,text),public.italia_elogy_finish(bigint,text,uuid,jsonb,integer,integer,boolean,text,text),public.italia_finance_mutate(bigint,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.italia_elogy_claim(bigint,text),public.italia_elogy_finish(bigint,text,uuid,jsonb,integer,integer,boolean,text,text),public.italia_finance_mutate(bigint,text,jsonb,uuid,text) to service_role;
notify pgrst,'reload schema';
