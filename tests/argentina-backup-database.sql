begin;
set local role service_role;
do $$
begin
 if not public.argentina_backup_claim('00000000-0000-0000-0000-000000000001') then raise exception 'claim failed'; end if;
 if public.argentina_backup_claim('00000000-0000-0000-0000-000000000002') then raise exception 'concurrent claim accepted'; end if;
 perform public.argentina_backup_release('00000000-0000-0000-0000-000000000002');
 if public.argentina_backup_claim('00000000-0000-0000-0000-000000000002') then raise exception 'foreign release accepted'; end if;
 perform public.argentina_backup_release('00000000-0000-0000-0000-000000000001');
 if not public.argentina_backup_claim('00000000-0000-0000-0000-000000000002') then raise exception 'release failed'; end if;
 if has_table_privilege('anon','public.argentina_shopify_extra','select') or has_function_privilege('authenticated','public.argentina_backup_claim(uuid)','execute') then raise exception 'public access'; end if;
end $$;
rollback;
