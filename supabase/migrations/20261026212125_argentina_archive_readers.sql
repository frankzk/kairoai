create view public.argentina_customers with(security_invoker=true) as
 select a.store_id,a.shopify_id as record_id,a.payload,a.archivado_at as archived_at,
 concat_ws(' ',a.payload->>'first_name',a.payload->>'last_name',a.payload->>'phone',a.payload->>'email',a.payload->>'tags',a.payload#>>'{default_address,phone}') as search_text
 from public.shopify_archivo a join public.stores s on s.id=a.store_id
 where s.code='kenku-ar' and s.active and a.recurso='customer';
create view public.argentina_products with(security_invoker=true) as
 select a.store_id,a.shopify_id as record_id,a.payload,a.archivado_at as archived_at,
 concat_ws(' ',a.payload->>'title',a.payload->>'vendor',a.payload->>'tags',a.payload->>'handle',a.payload->>'variants') as search_text
 from public.shopify_archivo a join public.stores s on s.id=a.store_id
 where s.code='kenku-ar' and s.active and a.recurso='product';
revoke all on public.argentina_customers,public.argentina_products from public,anon,authenticated;
grant select on public.argentina_customers,public.argentina_products to service_role;
notify pgrst,'reload schema';
