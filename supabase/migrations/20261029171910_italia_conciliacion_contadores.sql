-- One snapshot and one scan for all counters. Server-only, read-only RPC.
create function public.italia_reconciled_counts(p_store bigint,p_source text,p_search text,p_from timestamptz,p_to timestamptz,p_reconciliation text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (
  select status,count(*) as n from public.italia_orders_reconciled
  where store_id=p_store and (p_source='all' or source=p_source)
   and (p_search='' or search_text ilike p_search)
   and (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
   and (p_reconciliation='all' or reconciliation_state=p_reconciliation)
  group by status
 ) counts;
$$;
revoke all on function public.italia_reconciled_counts(bigint,text,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.italia_reconciled_counts(bigint,text,text,timestamptz,timestamptz,text) to service_role;
notify pgrst,'reload schema';
