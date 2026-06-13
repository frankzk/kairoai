-- ============================================================
-- Kairo AI - Multi-store finance support
-- Adds store partitioning so Shopify remains the only order base
-- per country, while Boxful logistics/liquidations only enrich
-- the matching store.
-- ============================================================

CREATE TABLE IF NOT EXISTS stores (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  country_code  TEXT        NOT NULL,
  currency      TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO stores (id, code, name, country_code, currency)
VALUES
  (1, 'mireva-cr', 'Mireva Costa Rica', 'CR', 'CRC'),
  (2, 'mireva-hn', 'Mireva Honduras', 'HN', 'HNL')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  country_code = EXCLUDED.country_code,
  currency = EXCLUDED.currency,
  active = TRUE,
  updated_at = NOW();

SELECT setval(
  pg_get_serial_sequence('stores', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM stores), 2),
  TRUE
);

ALTER TABLE product_costs ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE product_costs SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE product_costs ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE product_costs DROP CONSTRAINT IF EXISTS product_costs_store_fk;
ALTER TABLE product_costs
  ADD CONSTRAINT product_costs_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE product_costs DROP CONSTRAINT IF EXISTS product_costs_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS product_costs_store_sku_key
  ON product_costs (store_id, sku);
CREATE INDEX IF NOT EXISTS product_costs_store_idx ON product_costs (store_id);

ALTER TABLE product_cost_versions ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE product_cost_versions SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE product_cost_versions ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE product_cost_versions DROP CONSTRAINT IF EXISTS product_cost_versions_store_fk;
ALTER TABLE product_cost_versions
  ADD CONSTRAINT product_cost_versions_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS product_cost_versions_store_sku_effective_idx
  ON product_cost_versions (store_id, sku, effective_from DESC, created_at DESC);

ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE shopify_orders SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE shopify_orders ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE shopify_orders DROP CONSTRAINT IF EXISTS shopify_orders_store_fk;
ALTER TABLE shopify_orders
  ADD CONSTRAINT shopify_orders_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE shopify_orders DROP CONSTRAINT IF EXISTS shopify_orders_shopify_order_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS shopify_orders_store_order_id_key
  ON shopify_orders (store_id, shopify_order_id);
CREATE INDEX IF NOT EXISTS shopify_orders_store_created_idx
  ON shopify_orders (store_id, shopify_created_at DESC);
CREATE INDEX IF NOT EXISTS shopify_orders_store_name_idx ON shopify_orders (store_id, name);
CREATE INDEX IF NOT EXISTS shopify_orders_store_number_idx ON shopify_orders (store_id, order_number);

DO $$
BEGIN
  IF to_regclass('public.shopify_order_syncs') IS NOT NULL THEN
    ALTER TABLE shopify_order_syncs ADD COLUMN IF NOT EXISTS store_id BIGINT;
    UPDATE shopify_order_syncs SET store_id = 1 WHERE store_id IS NULL;
    ALTER TABLE shopify_order_syncs ALTER COLUMN store_id SET NOT NULL;
    ALTER TABLE shopify_order_syncs DROP CONSTRAINT IF EXISTS shopify_order_syncs_store_fk;
    ALTER TABLE shopify_order_syncs
      ADD CONSTRAINT shopify_order_syncs_store_fk
      FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE business_expenses ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE business_expenses SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE business_expenses ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE business_expenses DROP CONSTRAINT IF EXISTS business_expenses_store_fk;
ALTER TABLE business_expenses
  ADD CONSTRAINT business_expenses_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS business_expenses_store_type_date_idx
  ON business_expenses (store_id, type, expense_date DESC);
CREATE INDEX IF NOT EXISTS business_expenses_store_month_idx ON business_expenses (store_id, month);

ALTER TABLE settlement_imports ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE settlement_imports SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE settlement_imports ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE settlement_imports DROP CONSTRAINT IF EXISTS settlement_imports_store_fk;
ALTER TABLE settlement_imports
  ADD CONSTRAINT settlement_imports_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS settlement_imports_store_created_idx
  ON settlement_imports (store_id, created_at DESC);

ALTER TABLE settlement_rows ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE settlement_rows
SET store_id = settlement_imports.store_id
FROM settlement_imports
WHERE settlement_rows.import_id = settlement_imports.id
  AND settlement_rows.store_id IS NULL;
UPDATE settlement_rows SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE settlement_rows ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE settlement_rows DROP CONSTRAINT IF EXISTS settlement_rows_store_fk;
ALTER TABLE settlement_rows
  ADD CONSTRAINT settlement_rows_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS settlement_rows_store_import_idx ON settlement_rows (store_id, import_id);
CREATE INDEX IF NOT EXISTS settlement_rows_store_order_name_idx ON settlement_rows (store_id, order_name);
CREATE INDEX IF NOT EXISTS settlement_rows_store_internal_status_idx ON settlement_rows (store_id, internal_status);
CREATE INDEX IF NOT EXISTS settlement_rows_store_match_status_idx ON settlement_rows (store_id, match_status);

ALTER TABLE logistics_imports ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE logistics_imports SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE logistics_imports ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE logistics_imports DROP CONSTRAINT IF EXISTS logistics_imports_store_fk;
ALTER TABLE logistics_imports
  ADD CONSTRAINT logistics_imports_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS logistics_imports_store_created_idx
  ON logistics_imports (store_id, created_at DESC);

ALTER TABLE logistics_rows ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE logistics_rows
SET store_id = logistics_imports.store_id
FROM logistics_imports
WHERE logistics_rows.import_id = logistics_imports.id
  AND logistics_rows.store_id IS NULL;
UPDATE logistics_rows SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE logistics_rows ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE logistics_rows DROP CONSTRAINT IF EXISTS logistics_rows_store_fk;
ALTER TABLE logistics_rows
  ADD CONSTRAINT logistics_rows_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS logistics_rows_store_import_idx ON logistics_rows (store_id, import_id);
CREATE INDEX IF NOT EXISTS logistics_rows_store_order_name_idx ON logistics_rows (store_id, order_name);
CREATE INDEX IF NOT EXISTS logistics_rows_store_internal_status_idx ON logistics_rows (store_id, internal_status);
CREATE INDEX IF NOT EXISTS logistics_rows_store_match_status_idx ON logistics_rows (store_id, match_status);

ALTER TABLE finance_claims ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE finance_claims SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE finance_claims ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE finance_claims DROP CONSTRAINT IF EXISTS finance_claims_store_fk;
ALTER TABLE finance_claims
  ADD CONSTRAINT finance_claims_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE finance_claims DROP CONSTRAINT IF EXISTS finance_claims_anomaly_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS finance_claims_store_anomaly_key_key
  ON finance_claims (store_id, anomaly_key);
CREATE INDEX IF NOT EXISTS finance_claims_store_status_idx ON finance_claims (store_id, status);
CREATE INDEX IF NOT EXISTS finance_claims_store_order_idx ON finance_claims (store_id, order_name);

ALTER TABLE boxful_file_controls ADD COLUMN IF NOT EXISTS store_id BIGINT;
UPDATE boxful_file_controls SET store_id = 1 WHERE store_id IS NULL;
ALTER TABLE boxful_file_controls ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE boxful_file_controls DROP CONSTRAINT IF EXISTS boxful_file_controls_store_fk;
ALTER TABLE boxful_file_controls
  ADD CONSTRAINT boxful_file_controls_store_fk
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;
ALTER TABLE boxful_file_controls DROP CONSTRAINT IF EXISTS boxful_file_controls_file_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS boxful_file_controls_store_file_key
  ON boxful_file_controls (store_id, file_name, file_type);
CREATE INDEX IF NOT EXISTS boxful_file_controls_store_type_status_idx
  ON boxful_file_controls (store_id, file_type, status);

NOTIFY pgrst, 'reload schema';
