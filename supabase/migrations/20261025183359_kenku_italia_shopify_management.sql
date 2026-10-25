-- Gestión operativa separada del respaldo original. No escribe en Shopify.
create table public.italia_shopify_management (
  store_id bigint not null references public.stores(id),
  shopify_id text not null,
  recurso text not null default 'order' check(recurso='order'),
  status text check(status in ('pending','confirmed','partial','dispatched','delivered','cancelled','returned','refunded')),
  version integer not null default 0,
  note text not null default '' check(length(note)<=3000),
  courier text not null default '' check(length(courier)<=100),
  tracking_number text not null default '' check(length(tracking_number)<=150),
  updated_at timestamptz not null default now(),
  primary key(store_id,shopify_id),
  foreign key(store_id,recurso,shopify_id) references public.shopify_archivo(store_id,recurso,shopify_id)
);
create table public.italia_shopify_events (
  id bigint generated always as identity primary key,
  store_id bigint not null,
  shopify_id text not null,
  request_id uuid not null,
  version integer not null,
  actor text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(store_id,shopify_id) references public.italia_shopify_management(store_id,shopify_id),
  unique(store_id,shopify_id,request_id)
);
alter table public.italia_shopify_management enable row level security;
alter table public.italia_shopify_events enable row level security;
revoke all on public.italia_shopify_management,public.italia_shopify_events from public,anon,authenticated;
grant all on public.italia_shopify_management,public.italia_shopify_events to service_role;
grant usage,select on sequence public.italia_shopify_events_id_seq to service_role;

create function public.italia_shopify_status(p jsonb, managed text default null)
returns text language sql immutable security invoker set search_path='' as $$
 select case
  when nullif(p->>'cancelled_at','') is not null or p->>'financial_status'='voided' then 'cancelled'
  when p->>'financial_status'='refunded' then 'refunded'
  when managed is not null then managed
  when p->>'fulfillment_status'='fulfilled' then
    case when exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p->'fulfillments')='array' then p->'fulfillments' else '[]'::jsonb end) f where f->>'status'='success')
      and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p->'fulfillments')='array' then p->'fulfillments' else '[]'::jsonb end) f where f->>'status'='success' and (f->>'shipment_status') is distinct from 'delivered')
      then 'delivered' else 'dispatched' end
  when p->>'fulfillment_status'='partial' then 'partial'
  else 'pending' end;
$$;
revoke all on function public.italia_shopify_status(jsonb,text) from public,anon,authenticated;
grant execute on function public.italia_shopify_status(jsonb,text) to service_role;

-- UNION ALL conserva los identificadores originales de ambas plataformas.
-- La vista solo contiene Italia y obedece permisos/RLS del rol que la consulta.
create view public.italia_orders with(security_invoker=true) as
 select a.store_id,'shopify'::text as source,a.shopify_id as source_id,
   coalesce(a.payload->>'name',a.shopify_id) as order_number,
   coalesce(nullif(a.payload->>'created_at','')::timestamptz,a.archivado_at) as created_at,
   a.payload,public.italia_shopify_status(a.payload,m.status) as status,
   coalesce(m.version,0) as version,coalesce(m.version,0) as synced_version,
   null::text as last_error,coalesce(m.note,'') as management_note,
   coalesce(m.courier,'') as courier,coalesce(m.tracking_number,'') as tracking_number,
   m.updated_at as managed_at,a.shopify_updated_at as source_updated_at,
   concat_ws(' ',a.payload->>'name',a.payload->>'order_number',a.payload#>>'{customer,first_name}',a.payload#>>'{customer,last_name}',a.payload#>>'{shipping_address,name}',a.payload->>'phone',a.payload#>>'{shipping_address,phone}',a.payload#>>'{billing_address,phone}',a.payload#>>'{customer,phone}') as search_text
 from public.shopify_archivo a join public.stores s on s.id=a.store_id
 left join public.italia_shopify_management m on m.store_id=a.store_id and m.shopify_id=a.shopify_id
 where s.code='kenku-it' and s.active and a.recurso='order'
 union all
 select w.store_id,'woocommerce',w.id::text,w.order_number,
   coalesce(nullif(w.payload->>'created_at','')::timestamptz,w.created_at),w.payload,w.status,
   w.version,w.synced_version,w.last_error,''::text,''::text,''::text,
   null::timestamptz,w.updated_at,
   concat_ws(' ',w.order_number,w.payload->>'customer_name',w.payload->>'phone')
 from public.woo_orders w join public.stores s on s.id=w.store_id where s.code='kenku-it' and s.active;
revoke all on public.italia_orders from public,anon,authenticated;
grant select on public.italia_orders to service_role;

create function public.italia_manage_shopify(p_store bigint,p_id text,p_expected integer,p_source_updated timestamptz,
 p_status text,p_note text,p_courier text,p_tracking text,p_request uuid,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.shopify_archivo; m public.italia_shopify_management; e public.italia_shopify_events;
 current_status text; allowed text[]; previous jsonb; desired jsonb; new_version integer;
begin
 if not exists(select 1 from public.stores where id=p_store and code='kenku-it' and active) then
   return jsonb_build_object('error','not_found'); end if;
 -- Bloquea también el primer cambio; no hay carrera cuando aún no existe m.
 select * into a from public.shopify_archivo where store_id=p_store and recurso='order' and shopify_id=p_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if p_status is null or p_note is null or p_courier is null or p_tracking is null or p_request is null or p_actor is null
   or length(p_note)>3000 or length(p_courier)>100 or length(p_tracking)>150 then
   return jsonb_build_object('error','invalid_input'); end if;
 desired:=jsonb_build_object('status',p_status,'note',p_note,'courier',p_courier,'tracking_number',p_tracking);
 select * into e from public.italia_shopify_events where store_id=p_store and shopify_id=p_id and request_id=p_request;
 if found then
   if e.after_state=desired then return jsonb_build_object('ok',true,'duplicate',true,'version',e.version); end if;
   return jsonb_build_object('error','conflict');
 end if;
 select * into m from public.italia_shopify_management where store_id=p_store and shopify_id=p_id for update;
 if coalesce(m.version,0) is distinct from p_expected or a.shopify_updated_at is distinct from p_source_updated then
   return jsonb_build_object('error','conflict'); end if;
 current_status:=public.italia_shopify_status(a.payload,m.status);
 allowed:=case current_status when 'pending' then array['confirmed','cancelled']
   when 'confirmed' then array['dispatched','cancelled'] when 'partial' then array['dispatched','returned']
   when 'dispatched' then array['delivered','returned'] else array[]::text[] end;
 if p_status<>current_status and not(p_status=any(allowed)) then return jsonb_build_object('error','invalid_transition'); end if;
 previous:=jsonb_build_object('status',current_status,'note',coalesce(m.note,''),'courier',coalesce(m.courier,''),'tracking_number',coalesce(m.tracking_number,''));
 new_version:=coalesce(m.version,0)+1;
 insert into public.italia_shopify_management(store_id,shopify_id,status,version,note,courier,tracking_number)
 values(p_store,p_id,case when p_status=current_status then m.status else p_status end,new_version,p_note,p_courier,p_tracking)
 on conflict(store_id,shopify_id) do update set status=excluded.status,version=excluded.version,note=excluded.note,courier=excluded.courier,tracking_number=excluded.tracking_number,updated_at=now();
 insert into public.italia_shopify_events(store_id,shopify_id,request_id,version,actor,before_state,after_state)
 values(p_store,p_id,p_request,new_version,p_actor,previous,desired);
 return jsonb_build_object('ok',true,'version',new_version);
end $$;
revoke all on function public.italia_manage_shopify(bigint,text,integer,timestamptz,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.italia_manage_shopify(bigint,text,integer,timestamptz,text,text,text,text,uuid,text) to service_role;
notify pgrst,'reload schema';
