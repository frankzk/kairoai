begin;
set local role service_role;

do $$
begin
 if has_table_privilege('anon','public.argentina_orders','select') or
    has_table_privilege('authenticated','public.argentina_shopify_events','select') or
    has_table_privilege('authenticated','public.argentina_shopify_management','update') or
    has_function_privilege('anon','public.argentina_manage_shopify(bigint,text,integer,timestamptz,text,text,text,text,uuid,text)','execute') then
   raise exception 'Client role has privileged access';
 end if;
 if exists(select 1 from pg_class where oid in ('public.argentina_shopify_management'::regclass,'public.argentina_shopify_events'::regclass,'public.argentina_shopify_index'::regclass) and not relrowsecurity) then
   raise exception 'RLS missing';
 end if;
 if exists(select 1 from public.argentina_orders where store_id<>(select id from public.stores where code='kenku-ar')) then
   raise exception 'View includes another store';
 end if;
end $$;
do $$
declare sid bigint; other bigint; result jsonb; before_payload jsonb; request uuid:=gen_random_uuid();
begin
 select id into sid from public.stores where code='kenku-ar';
 select id into other from public.stores where code='mireva-cr';
 before_payload:='{"id":99999999999999,"name":"QA-ARGENTINA","created_at":"2026-10-25T12:00:00Z","currency":"ARS","financial_status":"paid","fulfillment_status":null,"shipping_address":{"zip":"C1000AAA"}}';
 insert into public.shopify_archivo(store_id,recurso,shopify_id,payload,shopify_updated_at)
 values(sid,'order','99999999999999',before_payload,'2026-10-25T12:00:00Z');
 if public.italia_shopify_status(before_payload) <> 'pending' then raise exception 'Paid is not delivered'; end if;
 if public.italia_shopify_status(before_payload||'{"fulfillment_status":"fulfilled","fulfillments":null}') <> 'dispatched' then raise exception 'Fulfilled is not delivered'; end if;
 if public.italia_shopify_status(before_payload||'{"fulfillment_status":"fulfilled","fulfillments":[{"status":"success","shipment_status":"delivered"}]}') <> 'delivered' then raise exception 'Delivery inference failed'; end if;
 if public.italia_shopify_status(before_payload||'{"cancelled_at":"2026-10-25"}','confirmed') <> 'cancelled' then raise exception 'Native cancellation must prevail'; end if;
 if public.italia_shopify_status(before_payload||'{"financial_status":"refunded"}','confirmed') <> 'refunded' then raise exception 'Refund must prevail'; end if;
 result:=public.argentina_manage_shopify(other,'99999999999999',0,'2026-10-25T12:00:00Z','confirmed','','','',gen_random_uuid(),'QA');
 if result->>'error'<>'not_found' then raise exception 'Cross-store accepted'; end if;
 result:=public.argentina_manage_shopify(sid,'99999999999999',0,'2026-10-25T12:00:00Z','delivered','','','',gen_random_uuid(),'QA');
 if result->>'error'<>'invalid_transition' then raise exception 'Skipped transition'; end if;
 result:=public.argentina_manage_shopify(sid,'99999999999999',0,'2026-10-25T12:00:00Z','pending','Only a note','','',request,'QA');
 if result->>'ok'<>'true' then raise exception 'Save failed'; end if;
 if (select status from public.argentina_shopify_management where store_id=sid and shopify_id='99999999999999') is not null then raise exception 'Note froze source status'; end if;
 result:=public.argentina_manage_shopify(sid,'99999999999999',0,'2026-10-25T12:00:00Z','pending','Only a note','','',request,'QA');
 if result->>'duplicate'<>'true' then raise exception 'Duplicate not recognized'; end if;
 result:=public.argentina_manage_shopify(sid,'99999999999999',0,'2026-10-25T12:00:00Z','confirmed','Changed','','',request,'QA');
 if result->>'error'<>'conflict' then raise exception 'Request id reused with different data'; end if;
 result:=public.argentina_manage_shopify(sid,'99999999999999',0,'2026-10-25T12:00:00Z','confirmed','','','',gen_random_uuid(),'QA');
 if result->>'error'<>'conflict' then raise exception 'Stale version accepted'; end if;
 result:=public.argentina_manage_shopify(sid,'99999999999999',1,'2026-10-24T12:00:00Z','confirmed','','','',gen_random_uuid(),'QA');
 if result->>'error'<>'conflict' then raise exception 'Stale source accepted'; end if;
 result:=public.argentina_manage_shopify(sid,'99999999999999',1,'2026-10-25T12:00:00Z','confirmed','Confirmed','QA Courier','TEST',gen_random_uuid(),'QA');
 if result->>'version'<>'2' then raise exception 'Confirmation failed'; end if;
 if (select count(*) from public.argentina_shopify_events where store_id=sid and shopify_id='99999999999999')<>2 then raise exception 'Wrong audit count'; end if;
 if (select payload from public.shopify_archivo where store_id=sid and recurso='order' and shopify_id='99999999999999')<>before_payload then raise exception 'Archive mutated'; end if;
 if exists(select 1 from public.woo_orders where store_id=sid and woo_id=99999999999999) then raise exception 'Shopify copied to Woo'; end if;
 if (select count(*) from public.argentina_orders where source='shopify' and source_id='99999999999999' and store_id=sid)<>1 then raise exception 'View duplicate'; end if;
 update public.shopify_archivo set payload=payload||'{"cancelled_at":"2026-10-25T13:00:00Z"}' where store_id=sid and recurso='order' and shopify_id='99999999999999';
 if (select status from public.argentina_orders where source='shopify' and source_id='99999999999999' and store_id=sid)<>'cancelled' then raise exception 'Projection did not refresh'; end if;
 if (select note from public.argentina_shopify_management where store_id=sid and shopify_id='99999999999999')<>'Confirmed' then raise exception 'Refresh erased management'; end if;
end $$;
rollback;
