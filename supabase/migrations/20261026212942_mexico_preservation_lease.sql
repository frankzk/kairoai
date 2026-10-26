-- The provider stops each invocation at 300 seconds; the lease must outlive it.
create or replace function public.shopify_preservation_claim(p_resource text,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare claimed integer;
begin
 insert into public.shopify_preservation_records(store_id,resource,record_id,payload)
 values(3,'_lease',p_resource,jsonb_build_object('token',p_token,'expires',now()+interval '600 seconds'))
 on conflict(store_id,resource,record_id) do update set payload=excluded.payload,archived_at=now()
 where (shopify_preservation_records.payload->>'expires')::timestamptz<now();
 get diagnostics claimed=row_count;
 return claimed=1;
end $$;
revoke all on function public.shopify_preservation_claim(text,uuid) from public,anon,authenticated;
grant execute on function public.shopify_preservation_claim(text,uuid) to service_role;
