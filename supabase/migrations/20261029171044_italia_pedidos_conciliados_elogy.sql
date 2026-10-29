-- Read-only reconciliation. Never writes a customer order, a manual management
-- record, Shopify or Elogy. Existing raw views and mutation contracts stay intact.
create view public.italia_orders_reconciled with(security_invoker=true) as
with refs as (
 select store_id,upper(regexp_replace(trim(order_number),'^#+','')) as ref,count(*) as n
 from (
  select i.store_id,i.order_number from public.italia_shopify_index i
  join public.stores s on s.id=i.store_id where s.code='kenku-it' and s.active
  union all
  select w.store_id,w.order_number from public.woo_orders w
  join public.stores s on s.id=w.store_id where s.code='kenku-it' and s.active
 ) r group by store_id,upper(regexp_replace(trim(order_number),'^#+',''))
), shipments as (
 select e.store_id,e.order_ref,count(*) as n,min(e.record_id) as record_id
 from public.italia_elogy_records e join public.stores s on s.id=e.store_id
 where s.code='kenku-it' and s.active and e.resource='shipments'
 group by e.store_id,e.order_ref
), matched as (
 select o.*,r.n as reference_count,coalesce(sh.n,0) as shipment_count,e.data as elogy,e.observed_at,
  case e.data->>'state'
   when 'created' then 'preparing' when 'in_transit' then 'dispatched'
   when 'out_for_delivery' then 'out_for_delivery' when 'incident' then 'incident'
   when 'delivered' then 'delivered' when 'returned' then 'returned'
   when 'returning' then 'returning' when 'cancelled' then 'cancelled'
  end as proposed_status,
  m.status as explicit_manual_status,
  case when (o.payload->>'total_price') ~ '^[0-9]+([.][0-9]+)?$'
    and nullif(e.data->>'currency','') is not null and nullif(e.data->>'total_cents','') is not null
   then e.data->>'currency'<>o.payload->>'currency'
     or (e.data->>'total_cents')::numeric<>round((o.payload->>'total_price')::numeric*100)
   else false end as amount_mismatch
 from public.italia_orders o
 left join refs r on r.store_id=o.store_id and r.ref=upper(regexp_replace(trim(o.order_number),'^#+',''))
 left join shipments sh on o.source='shopify' and sh.store_id=o.store_id
  and sh.order_ref=upper(regexp_replace(trim(o.order_number),'^#+',''))
 left join public.italia_elogy_records e on r.n=1 and sh.n=1
  and e.store_id=sh.store_id and e.resource='shipments' and e.record_id=sh.record_id
 left join public.italia_shopify_management m on o.source='shopify' and m.store_id=o.store_id and m.shopify_id=o.source_id
), classified as (
 select m.*,
  case
   when source<>'shopify' then 'not_applicable'
   when reference_count<>1 or shipment_count>1 then 'ambiguous'
   when shipment_count=0 then 'unmatched'
   when proposed_status is null or nullif(elogy->>'state_at','') is null then 'unknown'
   when amount_mismatch then 'review'
   -- Never silently reverse cancellation/refund, a terminal manual decision or
   -- a delivery/dispatch supported by Shopify with an earlier shipping stage.
   when proposed_status<>status and (
    status in ('cancelled','refunded') or explicit_manual_status in ('delivered','returned','cancelled','refunded')
    or (status='delivered' and proposed_status not in ('delivered','returned'))
    or (status in ('dispatched','partial') and proposed_status='preparing')
   ) then 'review'
   else 'matched'
  end as reconciliation_state
 from matched m
)
select store_id,source,source_id,order_number,created_at,payload,
 case when reconciliation_state='matched' then proposed_status else status end as status,
 version,synced_version,last_error,management_note,
 coalesce(nullif(courier,''),elogy->>'carrier','') as courier,
 coalesce(nullif(tracking_number,''),elogy->>'guide','') as tracking_number,
 managed_at,source_updated_at,
 concat_ws(' ',search_text,elogy->>'guide',elogy->>'carrier') as search_text,
 status as base_status,reconciliation_state,
 case when source='shopify' then jsonb_build_object(
  'applied',reconciliation_state='matched','status',elogy->>'state','label',elogy->>'state_label',
  'guide',elogy->>'guide','carrier',elogy->>'carrier','state_at',elogy->>'state_at','observed_at',observed_at,
  'reason',case when reconciliation_state='review' then case when amount_mismatch then 'amount' else 'protected_status' end else '' end,
  'total_cents',elogy->'total_cents','currency',elogy->>'currency'
 ) end as reconciliation
from classified;
revoke all on public.italia_orders_reconciled from public,anon,authenticated;
grant select on public.italia_orders_reconciled to service_role;
comment on view public.italia_orders_reconciled is 'Italy only: exact unique Shopify reference matched to Elogy shipment; preserve source and manual terminal conflicts.';
notify pgrst,'reload schema';
