-- Proyección pequeña: evita descomprimir miles de payloads para ordenar/contar.
create table public.italia_shopify_index (
 store_id bigint not null,
 shopify_id text not null,
 recurso text not null default 'order' check(recurso='order'),
 order_number text not null,
 created_at timestamptz not null,
 native_status text not null,
 search_text text not null,
 primary key(store_id,shopify_id),
 foreign key(store_id,recurso,shopify_id) references public.shopify_archivo(store_id,recurso,shopify_id) on delete cascade
);
alter table public.italia_shopify_index enable row level security;
revoke all on public.italia_shopify_index from public,anon,authenticated;
grant all on public.italia_shopify_index to service_role;
create index italia_shopify_index_date on public.italia_shopify_index(store_id,created_at desc,shopify_id desc);

create function public.italia_index_archived_order()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.stores where id=new.store_id and code='kenku-it') then
   insert into public.italia_shopify_index(store_id,shopify_id,order_number,created_at,native_status,search_text)
   values(new.store_id,new.shopify_id,coalesce(new.payload->>'name',new.shopify_id),
     coalesce(nullif(new.payload->>'created_at','')::timestamptz,new.archivado_at),
     public.italia_shopify_status(new.payload),
     concat_ws(' ',new.payload->>'name',new.payload->>'order_number',new.payload#>>'{customer,first_name}',new.payload#>>'{customer,last_name}',new.payload#>>'{shipping_address,name}',new.payload->>'phone',new.payload#>>'{shipping_address,phone}',new.payload#>>'{billing_address,phone}',new.payload#>>'{customer,phone}'))
   on conflict(store_id,shopify_id) do update set order_number=excluded.order_number,created_at=excluded.created_at,native_status=excluded.native_status,search_text=excluded.search_text;
 end if;
 return new;
end $$;
revoke all on function public.italia_index_archived_order() from public,anon,authenticated;
grant execute on function public.italia_index_archived_order() to service_role;
create trigger italia_archive_index after insert or update of payload on public.shopify_archivo
 for each row when(new.recurso='order') execute function public.italia_index_archived_order();

insert into public.italia_shopify_index(store_id,shopify_id,order_number,created_at,native_status,search_text)
select a.store_id,a.shopify_id,coalesce(a.payload->>'name',a.shopify_id),coalesce(nullif(a.payload->>'created_at','')::timestamptz,a.archivado_at),
 public.italia_shopify_status(a.payload),
 concat_ws(' ',a.payload->>'name',a.payload->>'order_number',a.payload#>>'{customer,first_name}',a.payload#>>'{customer,last_name}',a.payload#>>'{shipping_address,name}',a.payload->>'phone',a.payload#>>'{shipping_address,phone}',a.payload#>>'{billing_address,phone}',a.payload#>>'{customer,phone}')
from public.shopify_archivo a join public.stores s on s.id=a.store_id where s.code='kenku-it' and a.recurso='order';

create or replace view public.italia_orders with(security_invoker=true) as
 select a.store_id,'shopify'::text as source,a.shopify_id as source_id,i.order_number,i.created_at,a.payload,
   case when i.native_status in ('cancelled','refunded') then i.native_status else coalesce(m.status,i.native_status) end as status,
   coalesce(m.version,0) as version,coalesce(m.version,0) as synced_version,
   null::text as last_error,coalesce(m.note,'') as management_note,
   coalesce(m.courier,'') as courier,coalesce(m.tracking_number,'') as tracking_number,
   m.updated_at as managed_at,a.shopify_updated_at as source_updated_at,i.search_text
 from public.italia_shopify_index i join public.shopify_archivo a on a.store_id=i.store_id and a.recurso='order' and a.shopify_id=i.shopify_id
 join public.stores s on s.id=a.store_id
 left join public.italia_shopify_management m on m.store_id=a.store_id and m.shopify_id=a.shopify_id
 where s.code='kenku-it' and s.active
 union all
 select w.store_id,'woocommerce',w.id::text,w.order_number,
   coalesce(nullif(w.payload->>'created_at','')::timestamptz,w.created_at),w.payload,w.status,
   w.version,w.synced_version,w.last_error,''::text,''::text,''::text,
   null::timestamptz,w.updated_at,
   concat_ws(' ',w.order_number,w.payload->>'customer_name',w.payload->>'phone')
 from public.woo_orders w join public.stores s on s.id=w.store_id where s.code='kenku-it' and s.active;
revoke all on public.italia_orders from public,anon,authenticated;
grant select on public.italia_orders to service_role;
analyze public.italia_shopify_index;
notify pgrst,'reload schema';
