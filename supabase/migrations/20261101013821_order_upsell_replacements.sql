-- One durable replacement per original. Browser retries cannot create a second order.
create table public.order_upsell_replacements (
  id uuid primary key,
  store_id bigint not null references public.stores(id),
  original_id text not null,
  original_name text not null,
  advisor_id bigint not null references public.payroll_staff(id),
  advisor_name text not null,
  canal text not null check (canal in ('llamada','whatsapp','mensaje')),
  source_fingerprint text not null,
  payload jsonb not null,
  expected jsonb not null,
  selection jsonb not null,
  creation_started_at timestamptz,
  replacement_id text,
  replacement_name text,
  cancel_started_at timestamptz,
  completed_at timestamptz,
  lock_token uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, original_id),
  unique (store_id, original_name)
);
alter table public.order_upsell_replacements enable row level security;
revoke all on public.order_upsell_replacements from anon, authenticated;
grant select, insert, update on public.order_upsell_replacements to service_role;

-- Commit the two audit entries and completion marker together, once only.
create function public.finish_order_upsell(p_id uuid, p_store_id bigint, p_lock_token uuid, p_replacement_name text)
returns void language plpgsql security invoker set search_path = public as $$
declare r public.order_upsell_replacements;
begin
  select * into r from public.order_upsell_replacements
    where id=p_id and store_id=p_store_id and lock_token=p_lock_token for update;
  if not found then raise exception 'No se pudo recuperar el bloqueo del upsell'; end if;
  if r.completed_at is not null then return; end if;
  if r.replacement_id is null or r.cancel_started_at is null then raise exception 'Reemplazo sin verificar'; end if;
  insert into public.order_events(store_id,order_name,kind,outcome,message,staff_id,staff_name,metadata)
  values(r.store_id,r.original_name,'decision','anular',
    'Reemplazado por ' || p_replacement_name || ' con upsell. Original anulado en iComfly.',
    r.advisor_id,r.advisor_name,jsonb_build_object('upsell_id',r.id,'replacement_id',r.replacement_id,'replacement_name',p_replacement_name));
  insert into public.order_events(store_id,order_name,kind,outcome,message,staff_id,staff_name,canal,metadata)
  values(r.store_id,p_replacement_name,'contacto','confirmado',
    'Pedido con upsell confirmado en iComfly. Reemplaza ' || r.original_name || '. Total: ' || (r.expected->>'total'),
    r.advisor_id,r.advisor_name,r.canal,jsonb_build_object('upsell_id',r.id,'original_id',r.original_id,'original_name',r.original_name,'selection',r.selection));
  update public.order_upsell_replacements set completed_at=now(),replacement_name=p_replacement_name where id=r.id;
end;
$$;
revoke all on function public.finish_order_upsell(uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_order_upsell(uuid,bigint,uuid,text) to service_role;
notify pgrst, 'reload schema';
