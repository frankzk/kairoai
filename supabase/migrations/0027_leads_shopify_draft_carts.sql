-- ============================================================
-- Kairo AI - Borradores de Shopify como carritos en Leads.
--
-- Mantiene separadas las senales de Icomfly y Shopify para que una
-- sincronizacion no pueda borrar la informacion de la otra. Los borradores
-- se guardan en una tabla propia porque un telefono puede tener mas de uno.
-- Todo queda aislado por store_id.
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS icomfly_cart_signal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shopify_cart_open BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shopify_draft_cart_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shopify_draft_updated_at TIMESTAMPTZ;

-- Antes de esta migracion, has_cart_signal solo provenia de Icomfly.
UPDATE leads
SET icomfly_cart_signal = has_cart_signal
WHERE has_cart_signal
  AND NOT icomfly_cart_signal;

CREATE INDEX IF NOT EXISTS leads_store_shopify_cart_idx
  ON leads (store_id, shopify_cart_open, shopify_draft_updated_at DESC)
  WHERE shopify_cart_open;

CREATE TABLE IF NOT EXISTS shopify_draft_carts (
  id                       BIGSERIAL PRIMARY KEY,
  store_id                 BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lead_id                  BIGINT REFERENCES leads(id) ON DELETE SET NULL,
  shopify_draft_order_id   TEXT NOT NULL,
  shopify_draft_order_name TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  customer_name            TEXT,
  email                    TEXT,
  products                 TEXT NOT NULL DEFAULT '',
  item_count               INTEGER NOT NULL DEFAULT 0,
  total                    NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT '',
  invoice_url              TEXT,
  status                   TEXT NOT NULL DEFAULT 'open',
  is_open                  BOOLEAN NOT NULL DEFAULT TRUE,
  shopify_created_at       TIMESTAMPTZ,
  shopify_updated_at       TIMESTAMPTZ,
  last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at                TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, shopify_draft_order_id)
);

CREATE INDEX IF NOT EXISTS shopify_draft_carts_store_phone_idx
  ON shopify_draft_carts (store_id, phone, is_open, shopify_updated_at DESC);
CREATE INDEX IF NOT EXISTS shopify_draft_carts_lead_idx
  ON shopify_draft_carts (lead_id, is_open, shopify_updated_at DESC);

CREATE OR REPLACE FUNCTION shopify_draft_carts_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shopify_draft_carts_touch ON shopify_draft_carts;
CREATE TRIGGER shopify_draft_carts_touch
BEFORE UPDATE ON shopify_draft_carts
FOR EACH ROW EXECUTE FUNCTION shopify_draft_carts_touch_updated_at();

NOTIFY pgrst, 'reload schema';
