-- Run against the migrated database. All synthetic rows are rolled back.
begin;
set local role service_role;
do $$
declare
  request_id uuid := gen_random_uuid();
  lease uuid := gen_random_uuid();
  tenant bigint;
  advisor bigint;
  changed integer;
begin
  select min(id) into tenant from public.stores;
  select min(id) into advisor from public.payroll_staff;
  if tenant is null or advisor is null then raise exception 'Missing fixture dimensions'; end if;
  insert into public.order_upsell_replacements(id,store_id,original_id,original_name,advisor_id,advisor_name,canal,source_fingerprint,payload,expected,selection)
  values(request_id,tenant,'KAIRO-UPSELL-ROLLBACK-TEST','KAIRO-UPSELL-ROLLBACK-TEST',advisor,'Prueba técnica','llamada','test','{}','{"total":150}','{}');
  begin
    insert into public.order_upsell_replacements(id,store_id,original_id,original_name,advisor_id,advisor_name,canal,source_fingerprint,payload,expected,selection)
    values(gen_random_uuid(),tenant,'KAIRO-UPSELL-ROLLBACK-TEST','OTHER-NAME',advisor,'Prueba técnica','llamada','test','{}','{"total":150}','{}');
    raise exception 'Duplicate original was allowed';
  exception when unique_violation then null;
  end;
  update public.order_upsell_replacements set lock_token=lease,locked_until=now()+interval '10 minutes'
    where id=request_id and (locked_until is null or locked_until<now());
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'First lock failed'; end if;
  update public.order_upsell_replacements set lock_token=gen_random_uuid(),locked_until=now()+interval '10 minutes'
    where id=request_id and (locked_until is null or locked_until<now());
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Concurrent lock was allowed'; end if;
  update public.order_upsell_replacements set replacement_id='TEST-REPLACEMENT',creation_started_at=now(),cancel_started_at=now() where id=request_id;
  perform public.finish_order_upsell(request_id,tenant,lease,'KAIRO-UPSELL-REPLACEMENT-ROLLBACK-TEST');
  perform public.finish_order_upsell(request_id,tenant,lease,'KAIRO-UPSELL-REPLACEMENT-ROLLBACK-TEST');
  if (select count(*) from public.order_events where metadata->>'upsell_id'=request_id::text)<>2 then raise exception 'Audit entries duplicated or missing'; end if;
  if (select completed_at from public.order_upsell_replacements where id=request_id) is null then raise exception 'Completion missing'; end if;
end;
$$;
reset role;
select 'passed: unique original, exclusive lease, atomic completion and exactly two audit entries' as verification,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon','public.order_upsell_replacements','SELECT') as anon_can_read,
  has_function_privilege('anon','public.finish_order_upsell(uuid,bigint,uuid,text)','EXECUTE') as anon_can_finish
from pg_class c where c.oid='public.order_upsell_replacements'::regclass;
rollback;
