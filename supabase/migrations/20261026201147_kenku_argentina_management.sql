-- Kenku Argentina: Shopify conservado; gestión local independiente.
update public.stores set active=true, metadata=metadata||'{"solo_respaldo":false,"gestion_shopify":true}'::jsonb where code='kenku-ar';
-- Gestión operativa separada del respaldo original. No escribe en Shopify.
create table public.argentina_shopify_management (
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
create table public.argentina_shopify_events (
  id bigint generated always as identity primary key,
  store_id bigint not null,
  shopify_id text not null,
  request_id uuid not null,
  version integer not null,
  actor text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(store_id,shopify_id) references public.argentina_shopify_management(store_id,shopify_id),
  unique(store_id,shopify_id,request_id)
);
alter table public.argentina_shopify_management enable row level security;
alter table public.argentina_shopify_events enable row level security;
revoke all on public.argentina_shopify_management,public.argentina_shopify_events from public,anon,authenticated;
grant all on public.argentina_shopify_management,public.argentina_shopify_events to service_role;
grant usage,select on sequence public.argentina_shopify_events_id_seq to service_role;

create function public.argentina_manage_shopify(p_store bigint,p_id text,p_expected integer,p_source_updated timestamptz,
 p_status text,p_note text,p_courier text,p_tracking text,p_request uuid,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.shopify_archivo; m public.argentina_shopify_management; e public.argentina_shopify_events;
 current_status text; allowed text[]; previous jsonb; desired jsonb; new_version integer;
begin
 if not exists(select 1 from public.stores where id=p_store and code='kenku-ar' and active) then
   return jsonb_build_object('error','not_found'); end if;
 -- Bloquea también el primer cambio; no hay carrera cuando aún no existe m.
 select * into a from public.shopify_archivo where store_id=p_store and recurso='order' and shopify_id=p_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if p_status is null or p_note is null or p_courier is null or p_tracking is null or p_request is null or p_actor is null
   or length(p_note)>3000 or length(p_courier)>100 or length(p_tracking)>150 then
   return jsonb_build_object('error','invalid_input'); end if;
 desired:=jsonb_build_object('status',p_status,'note',p_note,'courier',p_courier,'tracking_number',p_tracking);
 select * into e from public.argentina_shopify_events where store_id=p_store and shopify_id=p_id and request_id=p_request;
 if found then
   if e.after_state=desired then return jsonb_build_object('ok',true,'duplicate',true,'version',e.version); end if;
   return jsonb_build_object('error','conflict');
 end if;
 select * into m from public.argentina_shopify_management where store_id=p_store and shopify_id=p_id for update;
 if coalesce(m.version,0) is distinct from p_expected or a.shopify_updated_at is distinct from p_source_updated then
   return jsonb_build_object('error','conflict'); end if;
 current_status:=public.italia_shopify_status(a.payload,m.status);
 allowed:=case current_status when 'pending' then array['confirmed','cancelled']
   when 'confirmed' then array['dispatched','cancelled'] when 'partial' then array['dispatched','returned']
   when 'dispatched' then array['delivered','returned'] else array[]::text[] end;
 if p_status<>current_status and not(p_status=any(allowed)) then return jsonb_build_object('error','invalid_transition'); end if;
 previous:=jsonb_build_object('status',current_status,'note',coalesce(m.note,''),'courier',coalesce(m.courier,''),'tracking_number',coalesce(m.tracking_number,''));
 new_version:=coalesce(m.version,0)+1;
 insert into public.argentina_shopify_management(store_id,shopify_id,status,version,note,courier,tracking_number)
 values(p_store,p_id,case when p_status=current_status then m.status else p_status end,new_version,p_note,p_courier,p_tracking)
 on conflict(store_id,shopify_id) do update set status=excluded.status,version=excluded.version,note=excluded.note,courier=excluded.courier,tracking_number=excluded.tracking_number,updated_at=now();
 insert into public.argentina_shopify_events(store_id,shopify_id,request_id,version,actor,before_state,after_state)
 values(p_store,p_id,p_request,new_version,p_actor,previous,desired);
 return jsonb_build_object('ok',true,'version',new_version);
end $$;
revoke all on function public.argentina_manage_shopify(bigint,text,integer,timestamptz,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.argentina_manage_shopify(bigint,text,integer,timestamptz,text,text,text,text,uuid,text) to service_role;
notify pgrst,'reload schema';
-- Proyección pequeña: evita descomprimir miles de payloads para ordenar/contar.
create table public.argentina_shopify_index (
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
alter table public.argentina_shopify_index enable row level security;
revoke all on public.argentina_shopify_index from public,anon,authenticated;
grant all on public.argentina_shopify_index to service_role;
create index argentina_shopify_index_date on public.argentina_shopify_index(store_id,created_at desc,shopify_id desc);

create function public.argentina_index_archived_order()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.stores where id=new.store_id and code='kenku-ar') then
   insert into public.argentina_shopify_index(store_id,shopify_id,order_number,created_at,native_status,search_text)
   values(new.store_id,new.shopify_id,coalesce(new.payload->>'name',new.shopify_id),
     coalesce(nullif(new.payload->>'created_at','')::timestamptz,new.archivado_at),
     public.italia_shopify_status(new.payload),
     concat_ws(' ',new.payload->>'name',new.payload->>'order_number',new.payload#>>'{customer,first_name}',new.payload#>>'{customer,last_name}',new.payload#>>'{shipping_address,name}',new.payload->>'phone',new.payload#>>'{shipping_address,phone}',new.payload#>>'{billing_address,phone}',new.payload#>>'{customer,phone}'))
   on conflict(store_id,shopify_id) do update set order_number=excluded.order_number,created_at=excluded.created_at,native_status=excluded.native_status,search_text=excluded.search_text;
 end if;
 return new;
end $$;
revoke all on function public.argentina_index_archived_order() from public,anon,authenticated;
grant execute on function public.argentina_index_archived_order() to service_role;
create trigger argentina_archive_index after insert or update of payload on public.shopify_archivo
 for each row when(new.recurso='order') execute function public.argentina_index_archived_order();

insert into public.argentina_shopify_index(store_id,shopify_id,order_number,created_at,native_status,search_text)
select a.store_id,a.shopify_id,coalesce(a.payload->>'name',a.shopify_id),coalesce(nullif(a.payload->>'created_at','')::timestamptz,a.archivado_at),
 public.italia_shopify_status(a.payload),
 concat_ws(' ',a.payload->>'name',a.payload->>'order_number',a.payload#>>'{customer,first_name}',a.payload#>>'{customer,last_name}',a.payload#>>'{shipping_address,name}',a.payload->>'phone',a.payload#>>'{shipping_address,phone}',a.payload#>>'{billing_address,phone}',a.payload#>>'{customer,phone}')
from public.shopify_archivo a join public.stores s on s.id=a.store_id where s.code='kenku-ar' and a.recurso='order';

create view public.argentina_orders with(security_invoker=true) as
 select a.store_id,'shopify'::text as source,a.shopify_id as source_id,i.order_number,i.created_at,a.payload,
   case when i.native_status in ('cancelled','refunded') then i.native_status else coalesce(m.status,i.native_status) end as status,
   coalesce(m.version,0) as version,coalesce(m.version,0) as synced_version,
   null::text as last_error,coalesce(m.note,'') as management_note,
   coalesce(m.courier,'') as courier,coalesce(m.tracking_number,'') as tracking_number,
   m.updated_at as managed_at,a.shopify_updated_at as source_updated_at,i.search_text
 from public.argentina_shopify_index i join public.shopify_archivo a on a.store_id=i.store_id and a.recurso='order' and a.shopify_id=i.shopify_id
 join public.stores s on s.id=a.store_id
 left join public.argentina_shopify_management m on m.store_id=a.store_id and m.shopify_id=a.shopify_id
 where s.code='kenku-ar' and s.active;
revoke all on public.argentina_orders from public,anon,authenticated;
grant select on public.argentina_orders to service_role;
analyze public.argentina_shopify_index;
notify pgrst,'reload schema';
