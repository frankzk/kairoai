-- Private extraction artifacts, independent from operational order state.
create table public.argentina_shopify_extra (
 store_id bigint not null default 4 references public.stores(id) check(store_id=4),
 resource text not null, external_id text not null, parent_id text,
 payload jsonb not null, captured_at timestamptz not null default now(),
 primary key(store_id,resource,external_id)
);
create table public.argentina_shopify_extra_state (
 store_id bigint not null default 4 references public.stores(id) check(store_id=4),
 resource text not null, status text not null default 'pending',
 next_url text, parent_id text, pages integer not null default 0,
 records integer not null default 0, meta jsonb not null default '{}',
 error text, updated_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,
 primary key(store_id,resource)
);
alter table public.argentina_shopify_extra enable row level security;
alter table public.argentina_shopify_extra_state enable row level security;
revoke all on public.argentina_shopify_extra,public.argentina_shopify_extra_state from public,anon,authenticated;
grant all on public.argentina_shopify_extra,public.argentina_shopify_extra_state to service_role;
create function public.argentina_backup_claim(p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.argentina_shopify_extra_state(resource) values('__lease') on conflict do nothing;
 update public.argentina_shopify_extra_state set lease_token=p_token,lease_until=now()+interval '6 minutes'
 where store_id=4 and resource='__lease' and (lease_until is null or lease_until<now());
 return found;
end $$;
create function public.argentina_backup_release(p_token uuid) returns void
language sql security invoker set search_path='' as $$
 update public.argentina_shopify_extra_state set lease_token=null,lease_until=null
 where store_id=4 and resource='__lease' and lease_token=p_token;
$$;
revoke all on function public.argentina_backup_claim(uuid),public.argentina_backup_release(uuid) from public,anon,authenticated;
grant execute on function public.argentina_backup_claim(uuid),public.argentina_backup_release(uuid) to service_role;
insert into storage.buckets(id,name,public,file_size_limit)
values('argentina-shopify-archive','argentina-shopify-archive',false,52428800)
on conflict(id) do nothing;
notify pgrst,'reload schema';
