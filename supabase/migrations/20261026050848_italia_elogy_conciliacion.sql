-- Liquidación documentada, cobro del courier y abono bancario son hechos separados.
alter table public.italia_elogy_payouts
 add column statement_proof text not null default '',
 add column adjustment_cents bigint not null default 0,
 add column adjustment_reason text not null default '',
 add column details_confirmed boolean not null default false,
 add column closed_at timestamptz,
 add column closed_by text not null default '',
 add constraint italia_payout_store_id unique(store_id,id),
 add constraint italia_payout_adjustment_reason check(adjustment_cents=0 or length(trim(adjustment_reason))>0);
create unique index italia_elogy_payout_reference_case on public.italia_elogy_payouts(store_id,lower(reference));
create table public.italia_elogy_statement_lines (
 id bigint generated always as identity primary key,store_id bigint not null,
 payout_id bigint not null,resource text not null check(resource in ('collected','costs')),
 source_id text not null,order_id text not null,order_ref text not null,
 amount_cents bigint not null,currency text not null default 'EUR' check(currency='EUR'),
 created_at timestamptz not null default now(),
 unique(store_id,resource,source_id),
 foreign key(store_id,payout_id) references public.italia_elogy_payouts(store_id,id),
 foreign key(store_id,resource,source_id) references public.italia_elogy_records(store_id,resource,record_id)
);
create index italia_elogy_lines_payout on public.italia_elogy_statement_lines(store_id,payout_id);
create table public.italia_elogy_bank_movements (
 id bigint generated always as identity primary key,store_id bigint not null references public.stores(id),
 account text not null check(length(trim(account)) between 1 and 100),
 reference text not null check(length(trim(reference)) between 1 and 160),
 value_date date not null,currency text not null check(currency in ('EUR','USD','GBP')),
 amount_cents bigint not null check(amount_cents>0),eur_cents bigint check(eur_cents>0),
 proof_reference text not null check(length(trim(proof_reference)) between 1 and 500),
 note text not null default '',version integer not null default 1,voided boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(store_id,id),check(currency<>'EUR' or (eur_cents is not null and eur_cents=amount_cents))
);
create unique index italia_elogy_bank_reference on public.italia_elogy_bank_movements(store_id,account,lower(reference));
create index italia_elogy_bank_date on public.italia_elogy_bank_movements(store_id,value_date desc);
create table public.italia_elogy_bank_allocations (
 id bigint generated always as identity primary key,store_id bigint not null,
 bank_id bigint not null,payout_id bigint not null,amount_cents bigint not null check(amount_cents>0),
 created_at timestamptz not null default now(),unique(store_id,bank_id,payout_id),
 foreign key(store_id,bank_id) references public.italia_elogy_bank_movements(store_id,id),
 foreign key(store_id,payout_id) references public.italia_elogy_payouts(store_id,id)
);
create index italia_elogy_allocations_payout on public.italia_elogy_bank_allocations(store_id,payout_id);
alter table public.italia_elogy_statement_lines enable row level security;
alter table public.italia_elogy_bank_movements enable row level security;
alter table public.italia_elogy_bank_allocations enable row level security;
revoke all on public.italia_elogy_statement_lines,public.italia_elogy_bank_movements,public.italia_elogy_bank_allocations from public,anon,authenticated;
grant all on public.italia_elogy_statement_lines,public.italia_elogy_bank_movements,public.italia_elogy_bank_allocations to service_role;
grant usage,select on sequence public.italia_elogy_statement_lines_id_seq,public.italia_elogy_bank_movements_id_seq,public.italia_elogy_bank_allocations_id_seq to service_role;

create function public.italia_elogy_reconcile(p_store bigint,p_action text,p_body jsonb,p_request uuid,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prior public.italia_finance_audit; payout public.italia_elogy_payouts;
 bank public.italia_elogy_bank_movements; src public.italia_elogy_records;
 source_id text; rsrc text; existing bigint; used bigint; paid bigint; last_paid date;
 line_count integer; gross bigint; fees bigint; changes integer;
 before_row jsonb;result jsonb;ids jsonb;reason text;
begin
 if not exists(select 1 from public.stores where id=p_store and code='kenku-it' and active) then raise exception 'wrong_store';end if;
 if p_request is null or p_actor is null or length(trim(p_actor))=0 or jsonb_typeof(p_body)<>'object' then raise exception 'invalid_input';end if;
 perform pg_advisory_xact_lock(hashtext('italia-finance:'||p_store::text));
 select * into prior from public.italia_finance_audit where store_id=p_store and request_id=p_request;
 if found then
  if prior.action<>'reconcile:'||p_action or prior.body<>p_body then return jsonb_build_object('error','request_reused');end if;
  return jsonb_build_object('ok',true,'duplicate',true);
 end if;
 if p_action='bank' then
  if exists(select 1 from public.italia_elogy_bank_movements where store_id=p_store and account=lower(trim(p_body->>'account')) and lower(reference)=lower(trim(p_body->>'reference'))) then return jsonb_build_object('error','bank_duplicate');end if;
  insert into public.italia_elogy_bank_movements(store_id,account,reference,value_date,currency,amount_cents,eur_cents,proof_reference,note)
  values(p_store,lower(trim(p_body->>'account')),trim(p_body->>'reference'),(p_body->>'date')::date,p_body->>'currency',(p_body->>'amount_cents')::bigint,(p_body->>'eur_cents')::bigint,trim(p_body->>'proof'),coalesce(p_body->>'note','')) returning * into bank;
  result=to_jsonb(bank);
 elsif p_action in ('bank_rate','bank_void') then
  select * into bank from public.italia_elogy_bank_movements where store_id=p_store and id=(p_body->>'bank_id')::bigint for update;
  if not found then return jsonb_build_object('error','not_found');end if;
  if bank.version is distinct from (p_body->>'version')::integer then return jsonb_build_object('error','conflict');end if;
  if bank.voided then return jsonb_build_object('error','bank_voided');end if;
  if length(trim(coalesce(p_body->>'reason','')))=0 then raise exception 'reason_required';end if;
  if exists(select 1 from public.italia_elogy_bank_allocations where store_id=p_store and bank_id=bank.id) then return jsonb_build_object('error','bank_allocated');end if;
  before_row=to_jsonb(bank);
  if p_action='bank_rate' then
   if bank.currency='EUR' or length(trim(coalesce(p_body->>'proof','')))=0 then raise exception 'invalid_fx';end if;
   update public.italia_elogy_bank_movements set eur_cents=(p_body->>'eur_cents')::bigint,proof_reference=trim(p_body->>'proof'),version=version+1,updated_at=clock_timestamp() where store_id=p_store and id=bank.id returning * into bank;
  else
   update public.italia_elogy_bank_movements set voided=true,version=version+1,updated_at=clock_timestamp() where store_id=p_store and id=bank.id returning * into bank;
  end if;
  result=to_jsonb(bank);
 else
  select * into payout from public.italia_elogy_payouts where store_id=p_store and id=(p_body->>'payout_id')::bigint for update;
  if not found then return jsonb_build_object('error','not_found');end if;
  if payout.version is distinct from (p_body->>'version')::integer then return jsonb_build_object('error','conflict');end if;
  if payout.closed_at is not null and p_action<>'reopen' then return jsonb_build_object('error','closed');end if;
  before_row=to_jsonb(payout);
  if p_action='statement' then
   if exists(select 1 from public.italia_elogy_payouts where store_id=p_store and id<>payout.id and lower(reference)=lower(trim(p_body->>'reference'))) then return jsonb_build_object('error','reference_exists');end if;
   if coalesce((p_body->>'confirmed')::boolean,false) and length(trim(coalesce(p_body->>'proof','')))=0 then raise exception 'proof_required';end if;
   update public.italia_elogy_payouts set reference=coalesce(nullif(trim(p_body->>'reference'),''),reference),statement_date=(p_body->>'date')::date,expected_cents=(p_body->>'expected_cents')::bigint,
    statement_proof=coalesce(p_body->>'proof',''),note=coalesce(p_body->>'note',''),details_confirmed=coalesce((p_body->>'confirmed')::boolean,false),
    adjustment_cents=coalesce((p_body->>'adjustment_cents')::bigint,0),adjustment_reason=coalesce(p_body->>'adjustment_reason','') where store_id=p_store and id=payout.id;
  elsif p_action='source_link' then
   rsrc=p_body->>'resource';ids=p_body->'ids';
   if rsrc not in ('collected','costs') or jsonb_typeof(ids)<>'array' or jsonb_array_length(ids) not between 1 and 100 then raise exception 'invalid_sources';end if;
   for source_id in select jsonb_array_elements_text(ids) order by 1 loop
    select * into src from public.italia_elogy_records where store_id=p_store and resource=rsrc and record_id=source_id for share;
    if not found then return jsonb_build_object('error','source_missing');end if;
    if src.order_ref not like 'KIT%' or src.data->>'total_cents' is null or
     (rsrc='collected' and (src.data->>'currency' is distinct from 'EUR' or (src.data->>'total_cents')::bigint<0)) or
     (rsrc='costs' and (src.data->>'country' is distinct from 'IT' or src.data->>'billing_type' is distinct from 'company' or coalesce(src.data->>'currency','') not in ('','EUR'))) then return jsonb_build_object('error','source_ineligible');end if;
    select payout_id into existing from public.italia_elogy_statement_lines where store_id=p_store and resource=rsrc and public.italia_elogy_statement_lines.source_id=src.record_id;
    if found and existing<>payout.id then return jsonb_build_object('error','source_assigned');end if;
   end loop;
   -- Validate the whole batch before inserting: an error must not commit half a selection.
   insert into public.italia_elogy_statement_lines(store_id,payout_id,resource,source_id,order_id,order_ref,amount_cents)
    select p_store,payout.id,rsrc,r.record_id,r.order_id,r.order_ref,(r.data->>'total_cents')::bigint
    from public.italia_elogy_records r where r.store_id=p_store and r.resource=rsrc and r.record_id in (select jsonb_array_elements_text(ids)) on conflict do nothing;
   update public.italia_elogy_payouts set details_confirmed=false where store_id=p_store and id=payout.id;
  elsif p_action='source_unlink' then
   if length(trim(coalesce(p_body->>'reason','')))=0 then raise exception 'reason_required';end if;
   select jsonb_build_object('statement',to_jsonb(payout),'line',to_jsonb(l)) into before_row from public.italia_elogy_statement_lines l where l.store_id=p_store and l.payout_id=payout.id and l.id=(p_body->>'line_id')::bigint;
   if not found then return jsonb_build_object('error','not_found');end if;
   delete from public.italia_elogy_statement_lines where store_id=p_store and payout_id=payout.id and id=(p_body->>'line_id')::bigint;
   update public.italia_elogy_payouts set details_confirmed=false where store_id=p_store and id=payout.id;
  elsif p_action in ('allocate','unallocate') then
   select * into bank from public.italia_elogy_bank_movements where store_id=p_store and id=(p_body->>'bank_id')::bigint for update;
   if not found then return jsonb_build_object('error','not_found');end if;
   if bank.voided then return jsonb_build_object('error','bank_voided');end if;
   select jsonb_build_object('statement',to_jsonb(payout),'bank',to_jsonb(bank),'allocation',to_jsonb(a)) into before_row
    from (select 1) x left join public.italia_elogy_bank_allocations a on a.store_id=p_store and a.payout_id=payout.id and a.bank_id=bank.id;
   if p_action='allocate' then
    if bank.eur_cents is null then return jsonb_build_object('error','fx_pending');end if;
    select coalesce(sum(amount_cents),0) into used from public.italia_elogy_bank_allocations where store_id=p_store and bank_id=bank.id and payout_id<>payout.id;
    if (p_body->>'amount_cents')::bigint<=0 or used+(p_body->>'amount_cents')::bigint>bank.eur_cents then return jsonb_build_object('error','bank_overallocated');end if;
    insert into public.italia_elogy_bank_allocations(store_id,bank_id,payout_id,amount_cents) values(p_store,bank.id,payout.id,(p_body->>'amount_cents')::bigint)
     on conflict(store_id,bank_id,payout_id) do update set amount_cents=excluded.amount_cents;
   else
    if length(trim(coalesce(p_body->>'reason','')))=0 then raise exception 'reason_required';end if;
    delete from public.italia_elogy_bank_allocations where store_id=p_store and bank_id=bank.id and payout_id=payout.id;
    if not found then return jsonb_build_object('error','not_found');end if;
   end if;
  elsif p_action='close' then
   if not payout.details_confirmed or length(trim(payout.statement_proof))=0 then return jsonb_build_object('error','detail_pending');end if;
   perform r.record_id from public.italia_elogy_records r join public.italia_elogy_statement_lines l on l.store_id=r.store_id and l.resource=r.resource and l.source_id=r.record_id where l.store_id=p_store and l.payout_id=payout.id order by r.resource,r.record_id for share of r;
   select count(*),coalesce(sum(l.amount_cents) filter(where l.resource='collected'),0),coalesce(sum(l.amount_cents) filter(where l.resource='costs'),0),
    count(*) filter(where r.record_id is null or (r.data->>'total_cents')::bigint is distinct from l.amount_cents or r.order_id is distinct from l.order_id or
     (l.resource='collected' and r.data->>'currency' is distinct from 'EUR') or
     (l.resource='costs' and (r.data->>'country' is distinct from 'IT' or r.data->>'billing_type' is distinct from 'company' or coalesce(r.data->>'currency','') not in ('','EUR'))))
    into line_count,gross,fees,changes from public.italia_elogy_statement_lines l left join public.italia_elogy_records r on r.store_id=l.store_id and r.resource=l.resource and r.record_id=l.source_id
    where l.store_id=p_store and l.payout_id=payout.id;
   if line_count=0 or gross-fees+payout.adjustment_cents<>payout.expected_cents then return jsonb_build_object('error','detail_difference');end if;
   if changes>0 then return jsonb_build_object('error','source_changed');end if;
   select coalesce(sum(a.amount_cents),0) into paid from public.italia_elogy_bank_allocations a join public.italia_elogy_bank_movements b on b.store_id=a.store_id and b.id=a.bank_id and not b.voided where a.store_id=p_store and a.payout_id=payout.id;
   if paid<>payout.expected_cents then return jsonb_build_object('error','bank_difference');end if;
   update public.italia_elogy_payouts set closed_at=clock_timestamp(),closed_by=left(p_actor,150) where store_id=p_store and id=payout.id;
  elsif p_action='reopen' then
   if payout.closed_at is null or length(trim(coalesce(p_body->>'reason','')))=0 then return jsonb_build_object('error','reopen_reason');end if;
   update public.italia_elogy_payouts set closed_at=null,closed_by='' where store_id=p_store and id=payout.id;
  else raise exception 'invalid_action';
  end if;
  select sum(a.amount_cents),max(b.value_date) into paid,last_paid from public.italia_elogy_bank_allocations a join public.italia_elogy_bank_movements b on b.store_id=a.store_id and b.id=a.bank_id and not b.voided where a.store_id=p_store and a.payout_id=payout.id;
  update public.italia_elogy_payouts set received_cents=paid,received_at=last_paid,version=version+1,updated_at=clock_timestamp() where store_id=p_store and id=payout.id returning to_jsonb(public.italia_elogy_payouts.*) into result;
  result=jsonb_build_object('statement',result,'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.italia_elogy_statement_lines l where l.store_id=p_store and l.payout_id=payout.id),'allocations',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.italia_elogy_bank_allocations a where a.store_id=p_store and a.payout_id=payout.id));
 end if;
 insert into public.italia_finance_audit(store_id,request_id,action,body,actor,before_data,after_data) values(p_store,p_request,'reconcile:'||p_action,p_body,left(p_actor,150),before_row,result);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.italia_elogy_reconcile(bigint,text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.italia_elogy_reconcile(bigint,text,jsonb,uuid,text) to service_role;
notify pgrst,'reload schema';
create or replace function public.italia_finance_mutate(p_store bigint,p_action text,p_body jsonb,p_request uuid,p_actor text) returns jsonb
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
    packaging_cost=(p_body->>'packaging_cents')::numeric/100,currency='EUR',provisional=coalesce((p_body->>'provisional')::boolean,false),effective_from=(p_body->>'effective_from')::date,active=true,updated_at=clock_timestamp()
    where id=cost.id and store_id=p_store returning * into cost;
  else
   if nullif(p_body->>'expected_updated_at','') is not null then return jsonb_build_object('error','conflict'); end if;
   insert into public.product_costs(store_id,sku,product_name,unit_cost,packaging_cost,currency,effective_from,active,provisional)
   values(p_store,lower(trim(p_body->>'sku')),p_body->>'name',(p_body->>'unit_cents')::numeric/100,(p_body->>'packaging_cents')::numeric/100,'EUR',(p_body->>'effective_from')::date,true,coalesce((p_body->>'provisional')::boolean,false)) returning * into cost;
  end if;
  insert into public.product_cost_versions(store_id,sku,product_name,unit_cost,packaging_cost,currency,effective_from,provisional)
  values(p_store,cost.sku,cost.product_name,cost.unit_cost,cost.packaging_cost,'EUR',cost.effective_from,cost.provisional);
  result=to_jsonb(cost);
 elsif p_action='expense' then
  if (p_body->>'amount_cents')::bigint<0 or length(p_body->>'description') not between 1 and 300 then raise exception 'invalid_expense'; end if;
  insert into public.business_expenses(store_id,type,expense_date,month,platform,category,description,amount,currency,notes)
  values(p_store,p_body->>'type',(p_body->>'date')::date,left(p_body->>'date',7),coalesce(p_body->>'platform',''),coalesce(p_body->>'category',''),p_body->>'description',(p_body->>'amount_cents')::numeric/100,'EUR',coalesce(p_body->>'note','')) returning * into expense;
  result=to_jsonb(expense);
 elsif p_action='payout' then
  if (p_body->>'expected_cents')::bigint<0 or length(p_body->>'reference') not between 1 and 120 then raise exception 'invalid_payout'; end if;
  if exists(select 1 from public.italia_elogy_payouts where store_id=p_store and lower(reference)=lower(p_body->>'reference')) then return jsonb_build_object('error','reference_exists'); end if;
  insert into public.italia_elogy_payouts(store_id,reference,statement_date,expected_cents,note)
  values(p_store,p_body->>'reference',(p_body->>'date')::date,(p_body->>'expected_cents')::bigint,coalesce(p_body->>'note','')) returning * into payout;
  result=to_jsonb(payout);
 elsif p_action='receipt' then
  raise exception 'bank_ledger_required';
 else raise exception 'invalid_action';
 end if;
 insert into public.italia_finance_audit(store_id,request_id,action,body,actor,before_data,after_data)
 values(p_store,p_request,p_action,p_body,left(p_actor,150),before_row,result);
 return jsonb_build_object('ok',true,'record',result);
end $$;



-- Disponibilidad con búsqueda parametrizada y páginas de 50, sin enviar el histórico completo al navegador.
create function public.italia_elogy_candidates(p_store bigint,p_resource text,p_search text default '',p_page integer default 1) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.stores where id=p_store and code='kenku-it' and active) then raise exception 'wrong_store';end if;
 if p_resource not in ('collected','costs') or p_page not between 1 and 1000 or length(p_search)>100 then raise exception 'invalid_filter';end if;
 with available as materialized (
  select r.record_id as id,r.resource,r.order_id,r.order_ref,r.occurred_at,r.data
  from public.italia_elogy_records r where r.store_id=p_store and r.resource=p_resource
   and not exists(select 1 from public.italia_elogy_statement_lines l where l.store_id=r.store_id and l.resource=r.resource and l.source_id=r.record_id)
   and (coalesce(p_search,'')='' or r.order_ref ilike '%'||p_search||'%' or r.data->>'guide' ilike '%'||p_search||'%')
 ), page as (select * from available order by occurred_at desc nulls last,id limit 50 offset (p_page-1)*50)
 select jsonb_build_object('count',(select count(*) from available),'rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'resource',p.resource,'ref',p.order_ref,'order_id',p.order_id,'date',p.occurred_at,
  'amount',(p.data->>'total_cents')::bigint,'currency',case when p.resource='costs' and coalesce(p.data->>'currency','')='' and p.data->>'country'='IT' then 'EUR' else p.data->>'currency' end,
  'guide',coalesce(p.data->>'guide',''),'assigned_to',null,'eligible',coalesce(p.data->>'total_cents' is not null and
   case when p.resource='collected' then p.data->>'currency'='EUR' and (p.data->>'total_cents')::bigint>=0
   else p.data->>'country'='IT' and p.data->>'billing_type'='company' and coalesce(p.data->>'currency','') in ('','EUR') end,false)
 )) from page p),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.italia_elogy_candidates(bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.italia_elogy_candidates(bigint,text,text,integer) to service_role;
notify pgrst,'reload schema';
