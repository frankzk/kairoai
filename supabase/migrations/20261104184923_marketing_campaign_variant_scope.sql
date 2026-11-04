alter table public.marketing_campaign_products
  add column family_key text,
  add column variant_scope text not null default 'legacy' check (variant_scope in ('legacy','all','selected','none')),
  add column variant_keys text[] not null default '{}' check (cardinality(variant_keys) <= 300);
alter table public.marketing_campaign_products add constraint marketing_variant_scope_members check (
  (variant_scope in ('legacy','none') and family_key is null and cardinality(variant_keys)=0)
  or (variant_scope='all' and family_key is not null and cardinality(variant_keys)=0)
  or (variant_scope='selected' and family_key is not null and cardinality(variant_keys)>0)
);
comment on column public.marketing_campaign_products.variant_scope is 'all resolves the current family members; selected freezes explicit member keys; none disables exact automatic matching for this campaign. Existing SKU assignments remain legacy.';
-- Existing RLS and service-role-only grants are unchanged; no public access is added.
