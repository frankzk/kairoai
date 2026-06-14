-- Guia y transportadora del fulfillment de Shopify, para mostrar pedidos
-- despachados (con tracking en Shopify) sin esperar el Excel de Boxful.
-- El backfill solo aplica a pedidos sincronizados despues de incluir el campo
-- fulfillments; los viejos quedan vacios hasta re-sincronizar.

ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS tracking_number  TEXT NOT NULL DEFAULT '';
ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS tracking_company TEXT NOT NULL DEFAULT '';

UPDATE shopify_orders SET
  tracking_number  = COALESCE(NULLIF(raw_order->'fulfillments'->0->>'tracking_number', ''), ''),
  tracking_company = COALESCE(NULLIF(raw_order->'fulfillments'->0->>'tracking_company', ''), '')
WHERE tracking_number = '' AND raw_order ? 'fulfillments';

CREATE INDEX IF NOT EXISTS shopify_orders_tracking_idx ON shopify_orders (tracking_number);
