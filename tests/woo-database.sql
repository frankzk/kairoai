begin;
set local role service_role;
do $$
declare s bigint; r jsonb; oid bigint; claim public.woo_orders; req uuid=gen_random_uuid();
begin
  select id into s from public.stores where code='kenku-it';
  r=public.woo_receive_order(s,'{"woo_id":999999991,"order_number":"TEST-ROLLBACK","currency":"EUR","address":{"postcode":"00118"}}');
  oid=(r->>'id')::bigint;
  if (r->>'duplicate')::boolean then raise exception 'fixture already exists'; end if;
  r=public.woo_receive_order(s,'{"woo_id":999999991,"order_number":"DO NOT OVERWRITE"}');
  if not (r->>'duplicate')::boolean then raise exception 'duplicate not detected'; end if;
  if (select order_number from public.woo_orders where id=oid)<>'TEST-ROLLBACK' then raise exception 'payload overwritten'; end if;
  r=public.woo_change_status(s,oid,0,'delivered',gen_random_uuid(),'test');
  if r->>'error'<>'invalid_transition' then raise exception 'skipped confirmation'; end if;
  r=public.woo_change_status(s,oid,0,'confirmed',req,'test');
  if not (r->>'ok')::boolean then raise exception 'cannot confirm'; end if;
  r=public.woo_change_status(s,oid,0,'confirmed',req,'test');
  if not (r->>'duplicate')::boolean then raise exception 'request idempotency'; end if;
  r=public.woo_change_status(s,oid,1,'dispatched',gen_random_uuid(),'test');
  if r->>'error'<>'conflict' then raise exception 'advanced before sync'; end if;
  -- Only this fixture can be pending during this verification.
  select * into claim from public.woo_claim_status();
  if claim.id<>oid then raise exception 'unexpected pending order'; end if;
  if exists(select 1 from public.woo_claim_status()) then raise exception 'claimed a leased order'; end if;
  perform public.woo_finish_status(oid,claim.lease_token,'Simulated timeout');
  if (select synced_version from public.woo_orders where id=oid)<>0 then raise exception 'acknowledged failure'; end if;
  if exists(select 1 from public.woo_claim_status()) then raise exception 'ignored retry delay'; end if;
  update public.woo_orders set next_attempt_at=now() where id=oid;
  select * into claim from public.woo_claim_status();
  perform public.woo_finish_status(oid,gen_random_uuid(),null);
  if (select synced_version from public.woo_orders where id=oid)<>0 then raise exception 'ignored lease token'; end if;
  perform public.woo_finish_status(oid,claim.lease_token,null);
  r=public.woo_change_status(s,oid,1,'dispatched',gen_random_uuid(),'test');
  if not (r->>'ok')::boolean then raise exception 'dispatch failed'; end if;
  if public.woo_change_status(s+100,oid,2,'cancelled',gen_random_uuid(),'test')->>'error'<>'not_found' then raise exception 'store isolation'; end if;
end $$;
rollback;
