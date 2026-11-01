-- Preserve cancelled attempts while allowing one new active attempt per original.
alter table public.order_upsell_replacements add column abandoned_at timestamptz;
alter table public.order_upsell_replacements add constraint order_upsell_not_completed_and_abandoned
  check (completed_at is null or abandoned_at is null);
alter table public.order_upsell_replacements drop constraint order_upsell_replacements_store_id_original_id_key;
alter table public.order_upsell_replacements drop constraint order_upsell_replacements_store_id_original_name_key;
create unique index order_upsell_active_original_id on public.order_upsell_replacements(store_id,original_id) where abandoned_at is null;
create unique index order_upsell_active_original_name on public.order_upsell_replacements(store_id,original_name) where abandoned_at is null;
notify pgrst, 'reload schema';
