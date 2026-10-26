-- Run only in the isolated PostgreSQL QA database, after all three Italy migrations.
begin;
create function pg_temp.reconcile(a text,b jsonb,q uuid default gen_random_uuid()) returns jsonb language sql as $$select public.italia_elogy_reconcile(5,a,b,q,'QA operator')$$;
create function pg_temp.version(i bigint) returns integer language sql as $$select version from public.italia_elogy_payouts where store_id=5 and id=i$$;
do $$
declare p bigint;p2 bigint;p0 bigint;b bigint;b2 bigint;foreign_bank bigint;r jsonb;req uuid;body jsonb;v integer;line_id bigint;
begin
 if has_table_privilege('anon','public.italia_elogy_bank_movements','select') or has_table_privilege('authenticated','public.italia_elogy_bank_allocations','insert') or has_function_privilege('anon','public.italia_elogy_reconcile(bigint,text,jsonb,uuid,text)','execute') then raise exception 'Public ledger exposure';end if;
 if not (select relrowsecurity from pg_class where oid='public.italia_elogy_bank_movements'::regclass) then raise exception 'Missing RLS';end if;
 insert into public.italia_elogy_records(store_id,resource,record_id,order_ref,order_id,data) values
 (5,'collected','C1','KITA1','O1','{"currency":"EUR","total_cents":10000}'),
 (5,'costs','F1','KITA1','O1','{"country":"IT","billing_type":"company","currency":"","total_cents":1000}'),
 (5,'costs','BAD','KITA1','O1','{"country":"IT","billing_type":"company","currency":"USD","total_cents":1000}');
 r=public.italia_finance_mutate(5,'payout','{"reference":"QA-1","date":"2026-09-30","expected_cents":9000}',gen_random_uuid(),'QA');p=(r->'record'->>'id')::bigint;
 r=public.italia_finance_mutate(5,'payout','{"reference":"QA-2","date":"2026-09-30","expected_cents":1000}',gen_random_uuid(),'QA');p2=(r->'record'->>'id')::bigint;
 r=pg_temp.reconcile('source_link',jsonb_build_object('payout_id',p,'version',1,'resource','collected','ids','["C1","MISSING"]'::jsonb));
 if r->>'error' is distinct from 'source_missing' or exists(select 1 from public.italia_elogy_statement_lines where payout_id=p) then raise exception 'Partial source batch committed';end if;
 r=pg_temp.reconcile('source_link',jsonb_build_object('payout_id',p,'version',1,'resource','collected','ids','["C1"]'::jsonb));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Link failed';end if;
 r=pg_temp.reconcile('source_link',jsonb_build_object('payout_id',p2,'version',1,'resource','collected','ids','["C1"]'::jsonb));if r->>'error' is distinct from 'source_assigned' then raise exception 'Double assigned COD';end if;
 r=pg_temp.reconcile('source_link',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'resource','costs','ids','["BAD"]'::jsonb));if r->>'error' is distinct from 'source_ineligible' then raise exception 'Foreign cost accepted';end if;
 r=pg_temp.reconcile('source_link',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'resource','costs','ids','["F1"]'::jsonb));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Cost link failed';end if;
 r=pg_temp.reconcile('close',jsonb_build_object('payout_id',p,'version',pg_temp.version(p)));if r->>'error' is distinct from 'detail_pending' then raise exception 'Unconfirmed detail closed';end if;
 r=pg_temp.reconcile('statement',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'date','2026-09-30','expected_cents',9000,'proof','Elogy statement 1','confirmed',true,'adjustment_cents',0));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Statement confirmation failed';end if;
 body='{"account":"bank","reference":"WIRE1","date":"2026-09-30","currency":"USD","amount_cents":4500,"eur_cents":null,"proof":"Bank line 1"}';req=gen_random_uuid();
 r=pg_temp.reconcile('bank',body,req);if not coalesce((r->>'ok')::boolean,false) then raise exception 'Bank insert failed';end if;
 select id into b from public.italia_elogy_bank_movements where store_id=5 and reference='WIRE1';
 r=pg_temp.reconcile('bank',body,req);if not coalesce((r->>'duplicate')::boolean,false) then raise exception 'Bank retry not idempotent';end if;
 r=pg_temp.reconcile('bank',body||'{"reference":"wire1"}',gen_random_uuid());if r->>'error' is distinct from 'bank_duplicate' then raise exception 'Duplicate bank reference accepted';end if;
 r=pg_temp.reconcile('allocate',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'bank_id',b,'amount_cents',4000));if r->>'error' is distinct from 'fx_pending' then raise exception 'Invented FX rate';end if;
 r=pg_temp.reconcile('bank_rate',jsonb_build_object('bank_id',b,'version',1,'eur_cents',4000,'proof','Bank FX confirmation','reason','Verified against receipt'));if not coalesce((r->>'ok')::boolean,false) then raise exception 'FX confirmation failed';end if;
 v=pg_temp.version(p);
 r=pg_temp.reconcile('allocate',jsonb_build_object('payout_id',p,'version',v,'bank_id',b,'amount_cents',4000));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Partial allocation failed';end if;
 r=pg_temp.reconcile('allocate',jsonb_build_object('payout_id',p,'version',v,'bank_id',b,'amount_cents',4000));if r->>'error' is distinct from 'conflict' then raise exception 'Stale statement version accepted';end if;
 r=pg_temp.reconcile('allocate',jsonb_build_object('payout_id',p2,'version',pg_temp.version(p2),'bank_id',b,'amount_cents',1));if r->>'error' is distinct from 'bank_overallocated' then raise exception 'Bank credit used twice';end if;
 r=pg_temp.reconcile('close',jsonb_build_object('payout_id',p,'version',pg_temp.version(p)));if r->>'error' is distinct from 'bank_difference' then raise exception 'Partial bank receipt closed';end if;
 r=pg_temp.reconcile('bank_void',jsonb_build_object('bank_id',b,'version',2,'reason','Attempted void'));if r->>'error' is distinct from 'bank_allocated' then raise exception 'Allocated bank credit voided';end if;
 r=pg_temp.reconcile('bank','{"account":"bank","reference":"WIRE2","date":"2026-10-02","currency":"EUR","amount_cents":5000,"eur_cents":5000,"proof":"October bank line"}');if not coalesce((r->>'ok')::boolean,false) then raise exception 'Second bank failed';end if;
 select id into b2 from public.italia_elogy_bank_movements where store_id=5 and reference='WIRE2';
 r=pg_temp.reconcile('allocate',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'bank_id',b2,'amount_cents',5000));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Second receipt failed';end if;
 if (select received_cents from public.italia_elogy_payouts where id=p)<>9000 or (select received_at from public.italia_elogy_payouts where id=p)<>'2026-10-02'::date then raise exception 'Receipt mirror incorrect';end if;
 req=gen_random_uuid();body=jsonb_build_object('payout_id',p,'version',pg_temp.version(p));
 r=pg_temp.reconcile('close',body,req);if not coalesce((r->>'ok')::boolean,false) then raise exception 'Complete statement did not close';end if;
 r=pg_temp.reconcile('close',body,req);if not coalesce((r->>'duplicate')::boolean,false) then raise exception 'Closing retry failed';end if;
 r=pg_temp.reconcile('unallocate',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'bank_id',b,'reason','Trying closed edit'));if r->>'error' is distinct from 'closed' then raise exception 'Closed allocation edited';end if;
 begin perform public.italia_finance_mutate(5,'receipt',jsonb_build_object('id',p,'version',pg_temp.version(p),'date','2026-10-01','received_cents',99999),gen_random_uuid(),'QA');raise exception 'Legacy bank shortcut accepted';exception when others then if sqlerrm<>'bank_ledger_required' then raise;end if;end;
 r=pg_temp.reconcile('reopen',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'reason','Investigating provider update'));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Reopen failed';end if;
 update public.italia_elogy_records set data=jsonb_set(data,'{total_cents}','11000') where store_id=5 and resource='collected' and record_id='C1';
 r=pg_temp.reconcile('close',jsonb_build_object('payout_id',p,'version',pg_temp.version(p)));if r->>'error' is distinct from 'source_changed' then raise exception 'Changed provider amount accepted';end if;
 update public.italia_elogy_records set data=jsonb_set(data,'{total_cents}','10000') where store_id=5 and resource='collected' and record_id='C1';
 select id into line_id from public.italia_elogy_statement_lines where store_id=5 and payout_id=p and resource='costs';
 r=pg_temp.reconcile('source_unlink',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'line_id',line_id,'reason','Wrong fee in statement'));if not coalesce((r->>'ok')::boolean,false) or (select details_confirmed from public.italia_elogy_payouts where id=p) then raise exception 'Unlink failed or confirmation retained';end if;
 r=pg_temp.reconcile('unallocate',jsonb_build_object('payout_id',p,'version',pg_temp.version(p),'bank_id',b,'reason','Receipt belongs elsewhere'));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Unallocate failed';end if;
 r=pg_temp.reconcile('bank_void',jsonb_build_object('bank_id',b,'version',2,'reason','Duplicate in source extract'));if not coalesce((r->>'ok')::boolean,false) then raise exception 'Unallocated bank credit could not be voided';end if;
 insert into public.italia_elogy_bank_movements(store_id,account,reference,value_date,currency,amount_cents,eur_cents,proof_reference) values(1,'foreign','FOREIGN','2026-10-01','EUR',10,10,'Foreign fixture') returning id into foreign_bank;
 r=pg_temp.reconcile('allocate',jsonb_build_object('payout_id',p2,'version',pg_temp.version(p2),'bank_id',foreign_bank,'amount_cents',10));if r->>'error' is distinct from 'not_found' then raise exception 'Cross-store bank credit read';end if;
 begin perform public.italia_elogy_reconcile(1,'bank','{}',gen_random_uuid(),'QA');raise exception 'Other store accepted';exception when others then if sqlerrm<>'wrong_store' then raise;end if;end;
 if (select count(*) from public.italia_finance_audit where store_id=5 and action='reconcile:bank')<>2 then raise exception 'Duplicate bank audit rows';end if;
 r=public.italia_elogy_candidates(5,'collected','',1);
 if (r->>'count')::integer<>0 then raise exception 'Assigned collection offered again';end if;
 r=public.italia_elogy_candidates(5,'costs','KITA1',1);
 if (r->>'count')::integer<>2 or jsonb_array_length(r->'rows')<>2 then raise exception 'Candidate search or unlink availability incorrect';end if;
 if (select (value->>'eligible')::boolean from jsonb_array_elements(r->'rows') where value->>'id'='BAD') then raise exception 'Candidate currency validation failed';end if;
 insert into public.italia_elogy_records(store_id,resource,record_id,order_ref,order_id,data)
  select 5,'collected','PAGE-'||i,'KITA-PAGE-'||i,'ORDER-'||i,'{"currency":"EUR","total_cents":100}'::jsonb from generate_series(1,55) i;
 r=public.italia_elogy_candidates(5,'collected','KITA-PAGE-',1);
 if (r->>'count')::integer<>55 or jsonb_array_length(r->'rows')<>50 then raise exception 'Candidate first page truncated count';end if;
 r=public.italia_elogy_candidates(5,'collected','KITA-PAGE-',2);
 if (r->>'count')::integer<>55 or jsonb_array_length(r->'rows')<>5 then raise exception 'Candidate second page incorrect';end if;
 raise notice 'PASS: private ledger, atomic source batches, duplicate COD, bank dedup, FX pending, partial receipts, no over-allocation, versions, closing, reopening, provider changes, legacy receipt guard and store isolation';
end $$;
rollback;
