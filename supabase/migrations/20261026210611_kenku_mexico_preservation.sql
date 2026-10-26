-- Private, resumable evidence of the extra Shopify resources for Mexico.
create table public.shopify_preservation_records (
 store_id bigint not null references public.stores(id),
 resource text not null,
 record_id text not null,
 payload jsonb not null,
 archived_at timestamptz not null default now(),
 primary key(store_id,resource,record_id)
);
alter table public.shopify_preservation_records enable row level security;
revoke all on public.shopify_preservation_records from public,anon,authenticated;
grant all on public.shopify_preservation_records to service_role;
insert into storage.buckets(id,name,public,file_size_limit)
 values('shopify-preservation','shopify-preservation',false,209715200);
create function public.shopify_preservation_claim(p_resource text,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare claimed integer;
begin
 insert into public.shopify_preservation_records(store_id,resource,record_id,payload)
 values(3,'_lease',p_resource,jsonb_build_object('token',p_token,'expires',now()+interval '290 seconds'))
 on conflict(store_id,resource,record_id) do update set payload=excluded.payload,archived_at=now()
 where (shopify_preservation_records.payload->>'expires')::timestamptz<now();
 get diagnostics claimed=row_count;
 return claimed=1;
end $$;
revoke all on function public.shopify_preservation_claim(text,uuid) from public,anon,authenticated;
grant execute on function public.shopify_preservation_claim(text,uuid) to service_role;
notify pgrst,'reload schema';

create view public.mexico_customers with(security_invoker=true) as
 select a.store_id,a.shopify_id as record_id,a.payload,a.archivado_at as archived_at,concat_ws(' ',a.payload->>'first_name',a.payload->>'last_name',a.payload->>'phone',a.payload->>'email',a.payload->>'tags',a.payload#>>'{default_address,phone}') as search_text from public.shopify_archivo a join public.stores s on s.id=a.store_id where s.code='kenku-mx' and s.active and a.recurso='customer';
create view public.mexico_products with(security_invoker=true) as
 select a.store_id,a.shopify_id as record_id,a.payload,a.archivado_at as archived_at,concat_ws(' ',a.payload->>'title',a.payload->>'vendor',a.payload->>'tags',a.payload->>'handle',a.payload->>'variants') as search_text from public.shopify_archivo a join public.stores s on s.id=a.store_id where s.code='kenku-mx' and s.active and a.recurso='product';
revoke all on public.mexico_customers,public.mexico_products from public,anon,authenticated;
grant select on public.mexico_customers,public.mexico_products to service_role;
notify pgrst,'reload schema';
