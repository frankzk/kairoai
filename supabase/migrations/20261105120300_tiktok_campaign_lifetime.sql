-- Resumen histórico por campaña de TikTok (05/11/2026).
--
-- La tabla de acciones de Marketing necesita, por campaña de TikTok, el gasto
-- y las conversiones acumuladas desde que empezó y el primer día con gasto
-- (fecha de lanzamiento para la regla de prueba: S/60 sin venta, S/200 con 5
-- pedidos). Make solo manda el gasto diario (tabla tiktok_ads_diario); esta
-- vista lo suma.
--
-- security_invoker: respeta los permisos de quien consulta. Solo service role.

create or replace view public.tiktok_ads_campanas_resumen
with (security_invoker = true) as
select
  store_id,
  advertiser_id,
  campaign_id,
  min(fecha) filter (where spend > 0) as first_date,
  max(fecha) as last_date,
  sum(spend) as spend,
  sum(conversions) as conversions,
  max(currency) as currency
from public.tiktok_ads_diario
group by store_id, advertiser_id, campaign_id;

revoke all on public.tiktok_ads_campanas_resumen from public, anon, authenticated;
grant select on public.tiktok_ads_campanas_resumen to service_role;

comment on view public.tiktok_ads_campanas_resumen is 'Gasto y conversiones acumuladas por campaña de TikTok (desde Make) y primer día con gasto; acceso solo servidor.';
