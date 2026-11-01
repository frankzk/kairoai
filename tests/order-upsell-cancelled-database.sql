begin;
set local role service_role;
do $$
declare tenant bigint; advisor bigint; old_id uuid:=gen_random_uuid(); new_id uuid:=gen_random_uuid();
begin
  select min(id) into tenant from public.stores;
  select min(id) into advisor from public.payroll_staff;
  insert into public.order_upsell_replacements(id,store_id,original_id,original_name,advisor_id,advisor_name,canal,source_fingerprint,payload,expected,selection)
  values(old_id,tenant,'CANCELLED-ATTEMPT-ROLLBACK-TEST','CANCELLED-ATTEMPT-ROLLBACK-TEST',advisor,'Prueba','llamada','test','{}','{}','{}');
  begin
    insert into public.order_upsell_replacements(id,store_id,original_id,original_name,advisor_id,advisor_name,canal,source_fingerprint,payload,expected,selection)
    values(new_id,tenant,'CANCELLED-ATTEMPT-ROLLBACK-TEST','CANCELLED-ATTEMPT-ROLLBACK-TEST',advisor,'Prueba','llamada','test','{}','{}','{}');
    raise exception 'Duplicate active attempt allowed';
  exception when unique_violation then null;
  end;
  update public.order_upsell_replacements set abandoned_at=now() where id=old_id;
  insert into public.order_upsell_replacements(id,store_id,original_id,original_name,advisor_id,advisor_name,canal,source_fingerprint,payload,expected,selection)
  values(new_id,tenant,'CANCELLED-ATTEMPT-ROLLBACK-TEST','CANCELLED-ATTEMPT-ROLLBACK-TEST',advisor,'Prueba','llamada','test','{}','{}','{}');
  if (select count(*) from public.order_upsell_replacements where original_id='CANCELLED-ATTEMPT-ROLLBACK-TEST')<>2 then raise exception 'Archived history lost'; end if;
  if (select count(*) from public.order_upsell_replacements where original_id='CANCELLED-ATTEMPT-ROLLBACK-TEST' and abandoned_at is null)<>1 then raise exception 'Active uniqueness failed'; end if;
  begin
    update public.order_upsell_replacements set completed_at=now() where id=old_id;
    raise exception 'Archived receipt completed';
  exception when check_violation then null;
  end;
end;
$$;
select 'passed: active uniqueness, preserved cancelled history and completion constraint' as verification;
rollback;
