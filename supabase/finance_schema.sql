-- ============================================================
-- Kairo AI - Finance / settlements schema
-- Run in Supabase SQL Editor after the base schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_costs (
  id              BIGSERIAL PRIMARY KEY,
  sku             TEXT          NOT NULL UNIQUE,
  product_name    TEXT          NOT NULL DEFAULT '',
  unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
  packaging_cost  NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT          NOT NULL DEFAULT 'CRC',
  effective_from  DATE          NOT NULL DEFAULT CURRENT_DATE,
  active          BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_costs_sku_idx ON product_costs (sku);

CREATE TABLE IF NOT EXISTS business_expenses (
  id            BIGSERIAL PRIMARY KEY,
  type          TEXT          NOT NULL CHECK (type IN ('ads','payroll','misc')),
  expense_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
  month         TEXT          NOT NULL DEFAULT '',
  platform      TEXT          NOT NULL DEFAULT '',
  category      TEXT          NOT NULL DEFAULT '',
  description   TEXT          NOT NULL DEFAULT '',
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency      TEXT          NOT NULL DEFAULT 'CRC',
  notes         TEXT          NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS business_expenses_type_date_idx
  ON business_expenses (type, expense_date DESC);
CREATE INDEX IF NOT EXISTS business_expenses_month_idx ON business_expenses (month);

CREATE TABLE IF NOT EXISTS settlement_imports (
  id                    BIGSERIAL PRIMARY KEY,
  file_name             TEXT          NOT NULL,
  period_label          TEXT          NOT NULL DEFAULT '',
  period_start          DATE,
  period_end            DATE,
  total_rows            INTEGER       NOT NULL DEFAULT 0,
  matched_rows          INTEGER       NOT NULL DEFAULT 0,
  unmatched_rows        INTEGER       NOT NULL DEFAULT 0,
  total_collected       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_to_liquidate    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status_summary        JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_rows (
  id                         BIGSERIAL PRIMARY KEY,
  import_id                  BIGINT        NOT NULL REFERENCES settlement_imports(id) ON DELETE CASCADE,
  guide_number               TEXT          NOT NULL DEFAULT '',
  order_name                 TEXT          NOT NULL DEFAULT '',
  store_order_number         TEXT          NOT NULL DEFAULT '',
  customer_name              TEXT          NOT NULL DEFAULT '',
  customer_phone             TEXT          NOT NULL DEFAULT '',
  created_on                 DATE,
  courier                    TEXT          NOT NULL DEFAULT '',
  service_type               TEXT          NOT NULL DEFAULT '',
  cod_amount                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  cod_commission             NUMERIC(12,2) NOT NULL DEFAULT 0,
  card_commission            NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_cost              NUMERIC(12,2) NOT NULL DEFAULT 0,
  pick_pack_cost             NUMERIC(12,2) NOT NULL DEFAULT 0,
  packaging_cost             NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_to_liquidate        NUMERIC(12,2) NOT NULL DEFAULT 0,
  settlement_status          TEXT          NOT NULL DEFAULT '',
  internal_status            TEXT          NOT NULL DEFAULT 'pending',
  match_status               TEXT          NOT NULL DEFAULT 'unmatched',
  shopify_order_id           TEXT          NOT NULL DEFAULT '',
  shopify_order_name         TEXT          NOT NULL DEFAULT '',
  shopify_financial_status   TEXT          NOT NULL DEFAULT '',
  shopify_fulfillment_status TEXT          NOT NULL DEFAULT '',
  shopify_total              NUMERIC(12,2) NOT NULL DEFAULT 0,
  shopify_created_at         TIMESTAMPTZ,
  order_items                JSONB         NOT NULL DEFAULT '[]'::jsonb,
  raw_row                    JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settlement_rows_import_idx ON settlement_rows (import_id);
CREATE INDEX IF NOT EXISTS settlement_rows_order_name_idx ON settlement_rows (order_name);
CREATE INDEX IF NOT EXISTS settlement_rows_internal_status_idx ON settlement_rows (internal_status);
CREATE INDEX IF NOT EXISTS settlement_rows_match_status_idx ON settlement_rows (match_status);

NOTIFY pgrst, 'reload schema';
