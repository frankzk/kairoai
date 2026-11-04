alter table public.marketing_campaign_products
  add column campaign_alias text;
alter table public.marketing_campaign_products
  add constraint marketing_campaign_alias_scope check (
    campaign_alias is null or (
      variant_scope in ('all','selected') and family_key is not null
      and char_length(campaign_alias) between 4 and 160
      and campaign_alias ~ '^[a-z0-9]+( [a-z0-9]+)*$'
    )
  );
comment on column public.marketing_campaign_products.campaign_alias is 'Explicit alias learned from a manual campaign mapping. Same-store exact matches reuse the product and variant scope across Meta and TikTok; conflicting targets block automatic assignment. Null opts out.';
-- Existing RLS and server-only grants are unchanged.
