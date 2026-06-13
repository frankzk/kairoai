-- Nombre y apellido del cliente como columnas propias (antes solo se guardaba
-- el nombre completo combinado en customer_name). Se rellenan desde la fuente
-- cruda: customer/billing del pedido Shopify y las columnas Nombre/Apellido
-- del Excel de Boxful.

ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS last_name  TEXT NOT NULL DEFAULT '';

UPDATE shopify_orders SET
  first_name = COALESCE(
    NULLIF(raw_order->'customer'->>'first_name', ''),
    NULLIF(raw_order->'billing_address'->>'first_name', ''),
    ''
  ),
  last_name = COALESCE(
    NULLIF(raw_order->'customer'->>'last_name', ''),
    NULLIF(raw_order->'billing_address'->>'last_name', ''),
    NULLIF(raw_order->'shipping_address'->>'last_name', ''),
    ''
  )
WHERE last_name = '' AND first_name = '';

ALTER TABLE logistics_rows ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE logistics_rows ADD COLUMN IF NOT EXISTS last_name  TEXT NOT NULL DEFAULT '';

UPDATE logistics_rows SET
  first_name = COALESCE(NULLIF(TRIM(raw_row->>'Nombre'), ''), ''),
  last_name  = COALESCE(NULLIF(TRIM(raw_row->>'Apellido'), ''), '')
WHERE last_name = '' AND first_name = '';

ALTER TABLE settlement_rows ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT '';
ALTER TABLE settlement_rows ADD COLUMN IF NOT EXISTS last_name  TEXT NOT NULL DEFAULT '';

UPDATE settlement_rows SET
  first_name = COALESCE(NULLIF(TRIM(raw_row->>'Nombre'), ''), ''),
  last_name  = COALESCE(NULLIF(TRIM(raw_row->>'Apellido'), ''), '')
WHERE last_name = '' AND first_name = '';

CREATE INDEX IF NOT EXISTS shopify_orders_last_name_idx  ON shopify_orders  (lower(last_name));
CREATE INDEX IF NOT EXISTS logistics_rows_last_name_idx  ON logistics_rows  (lower(last_name));
CREATE INDEX IF NOT EXISTS settlement_rows_last_name_idx ON settlement_rows (lower(last_name));
