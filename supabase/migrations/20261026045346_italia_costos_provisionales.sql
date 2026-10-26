-- Una estimación solicitada por el dueño no se presenta como costo comprobado.
alter table public.product_costs add column provisional boolean not null default false;
alter table public.product_cost_versions add column provisional boolean not null default false;
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

notify pgrst,'reload schema';
