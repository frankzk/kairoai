-- Respaldo de Shopify: todo lo que da el Admin API y tambien las tres Kenku.
--
-- Shopify cierra el 28/10/2026 en las cinco tiendas. 0049 guardaba pedidos,
-- clientes y productos; esto agrega el resto (carritos abandonados, colecciones,
-- paginas, blog, politicas, redirecciones, descuentos, borradores, bodegas,
-- inventario, metacampos) y las tiendas de SOLO respaldo: Kenku Mexico,
-- Argentina e Italia. Van con active = false: no son tiendas de Kairo todavia y
-- listPlatformStores (lib/platform.ts) solo lee las activas. El codigo las lista
-- en TIENDAS_SOLO_RESPALDO (lib/stores.ts) con los mismos ids.
--
-- La lista de recursos es la de CONFIG_RECURSOS en lib/shopify-archivo.ts
-- (tests/shopify-archivo.test.ts compara las dos).

ALTER TABLE public.shopify_archivo DROP CONSTRAINT IF EXISTS shopify_archivo_recurso_check;
ALTER TABLE public.shopify_archivo ADD CONSTRAINT shopify_archivo_recurso_check CHECK (recurso IN (
  'order', 'customer', 'product', 'checkout', 'custom_collection', 'smart_collection', 'collect',
  'page', 'blog', 'article', 'policy', 'shop', 'redirect', 'price_rule', 'discount_code',
  'draft_order', 'location', 'inventory_level', 'shop_metafield', 'product_metafield'
));

ALTER TABLE public.shopify_archivo_estado DROP CONSTRAINT IF EXISTS shopify_archivo_estado_recurso_check;
ALTER TABLE public.shopify_archivo_estado ADD CONSTRAINT shopify_archivo_estado_recurso_check CHECK (recurso IN (
  'order', 'customer', 'product', 'checkout', 'custom_collection', 'smart_collection', 'collect',
  'page', 'blog', 'article', 'policy', 'shop', 'redirect', 'price_rule', 'discount_code',
  'draft_order', 'location', 'inventory_level', 'shop_metafield', 'product_metafield'
));

-- Los recursos que cuelgan de otro (articulos de un blog, inventario de una
-- bodega) se recorren padre por padre; el cursor de Shopify no dice de cual.
ALTER TABLE public.shopify_archivo_estado ADD COLUMN IF NOT EXISTS padre_actual TEXT;

INSERT INTO public.stores (id, code, name, short_name, country_code, currency, timezone, locale, active, metadata)
VALUES
  (3, 'kenku-mx', 'Kenku México', 'México', 'MX', 'MXN', 'America/Mexico_City', 'es-MX', false, '{"solo_respaldo": true}'),
  (4, 'kenku-ar', 'Kenku Argentina', 'Argentina', 'AR', 'ARS', 'America/Argentina/Buenos_Aires', 'es-AR', false, '{"solo_respaldo": true}'),
  (5, 'kenku-it', 'Kenku Italia', 'Italia', 'IT', 'EUR', 'Europe/Rome', 'it-IT', false, '{"solo_respaldo": true}')
ON CONFLICT (id) DO NOTHING;

-- Los ids van fijos (el codigo los usa); la secuencia sigue despues.
SELECT setval('public.stores_id_seq', GREATEST((SELECT max(id) FROM public.stores), 1));

NOTIFY pgrst, 'reload schema';
