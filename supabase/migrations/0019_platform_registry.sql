-- ============================================================
-- Kairo AI - Platform registry for 8+ stores
-- Adds DB-backed onboarding primitives without changing the
-- existing Costa Rica / Honduras flows.
-- ============================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS short_name TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Costa_Rica';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es-CR';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS shopify_created_at_min TIMESTAMPTZ;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS default_courier_code TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE stores
SET
  short_name = COALESCE(short_name, 'Costa Rica'),
  timezone = COALESCE(NULLIF(timezone, ''), 'America/Costa_Rica'),
  locale = COALESCE(NULLIF(locale, ''), 'es-CR'),
  shopify_created_at_min = COALESCE(shopify_created_at_min, '2026-01-01T00:00:00-06:00'::timestamptz),
  default_courier_code = COALESCE(default_courier_code, 'moovin')
WHERE code = 'mireva-cr';

UPDATE stores
SET
  short_name = COALESCE(short_name, 'Honduras'),
  timezone = COALESCE(NULLIF(timezone, ''), 'America/Tegucigalpa'),
  locale = COALESCE(NULLIF(locale, ''), 'es-HN'),
  shopify_created_at_min = COALESCE(shopify_created_at_min, '2025-12-09T00:00:00-06:00'::timestamptz),
  default_courier_code = COALESCE(default_courier_code, 'forza')
WHERE code = 'mireva-hn';

CREATE TABLE IF NOT EXISTS store_integrations (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT      NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  provider            TEXT        NOT NULL,
  enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Secret values stay in Vercel/env. These keys only name the env vars.
  secret_env_refs      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  public_config        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, provider)
);

CREATE TABLE IF NOT EXISTS courier_accounts (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT      NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  courier_code         TEXT        NOT NULL,
  display_name         TEXT        NOT NULL,
  country_code         TEXT        NOT NULL DEFAULT '',
  mode                 TEXT        NOT NULL DEFAULT 'file'
                                      CHECK (mode IN ('api','file','both')),
  enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
  secret_env_refs      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  public_config        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, courier_code)
);

CREATE TABLE IF NOT EXISTS courier_file_profiles (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT      REFERENCES stores(id) ON DELETE CASCADE,
  courier_code         TEXT        NOT NULL,
  profile_code         TEXT        NOT NULL,
  file_type            TEXT        NOT NULL CHECK (file_type IN ('logistica','liquidacion')),
  version              INT         NOT NULL DEFAULT 1,
  active               BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Column aliases and status maps are JSON so a new courier can be onboarded
  -- without a code deploy while the adapter layer is still generic.
  column_map           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status_map           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  required_columns     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, courier_code, profile_code, file_type, version)
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id                  UUID        PRIMARY KEY,
  email               TEXT        NOT NULL UNIQUE,
  full_name           TEXT        NOT NULL DEFAULT '',
  active              BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_store_roles (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  store_id            BIGINT      NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  role                TEXT        NOT NULL CHECK (role IN ('owner','admin','finance','ops','viewer')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, store_id, role)
);

CREATE TABLE IF NOT EXISTS courier_shipments (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT      NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  courier_code         TEXT        NOT NULL,
  guide_number         TEXT        NOT NULL,
  order_name           TEXT        NOT NULL DEFAULT '',
  shopify_order_id     TEXT        NOT NULL DEFAULT '',
  normalized_status    TEXT        NOT NULL DEFAULT 'unknown',
  raw_status           TEXT        NOT NULL DEFAULT '',
  latest_at            TIMESTAMPTZ,
  has_incident         BOOLEAN     NOT NULL DEFAULT FALSE,
  incident_reason      TEXT        NOT NULL DEFAULT '',
  raw_payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  checked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, courier_code, guide_number)
);

CREATE TABLE IF NOT EXISTS courier_tracking_events (
  id                  BIGSERIAL PRIMARY KEY,
  store_id            BIGINT      NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  courier_code         TEXT        NOT NULL,
  guide_number         TEXT        NOT NULL,
  event_code           TEXT        NOT NULL DEFAULT '',
  normalized_group     TEXT        NOT NULL DEFAULT 'unknown',
  title                TEXT        NOT NULL DEFAULT '',
  description          TEXT        NOT NULL DEFAULT '',
  event_at             TIMESTAMPTZ,
  raw_payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS store_integrations_store_provider_idx
  ON store_integrations (store_id, provider);
CREATE INDEX IF NOT EXISTS courier_accounts_store_code_idx
  ON courier_accounts (store_id, courier_code);
CREATE INDEX IF NOT EXISTS courier_file_profiles_lookup_idx
  ON courier_file_profiles (store_id, courier_code, file_type, active);
CREATE INDEX IF NOT EXISTS user_store_roles_store_role_idx
  ON user_store_roles (store_id, role);
CREATE INDEX IF NOT EXISTS courier_shipments_store_status_idx
  ON courier_shipments (store_id, courier_code, normalized_status);
CREATE INDEX IF NOT EXISTS courier_tracking_events_guide_idx
  ON courier_tracking_events (store_id, courier_code, guide_number, event_at DESC);

INSERT INTO store_integrations (store_id, provider, secret_env_refs, public_config)
SELECT id, 'shopify',
  jsonb_build_object(
    'shopDomain', CASE WHEN code = 'mireva-cr' THEN 'SHOPIFY_CR_SHOP_DOMAIN' ELSE 'SHOPIFY_HN_SHOP_DOMAIN' END,
    'accessToken', CASE WHEN code = 'mireva-cr' THEN 'SHOPIFY_CR_ACCESS_TOKEN' ELSE 'SHOPIFY_HN_ACCESS_TOKEN' END,
    'clientId', CASE WHEN code = 'mireva-cr' THEN 'SHOPIFY_CR_CLIENT_ID' ELSE 'SHOPIFY_HN_CLIENT_ID' END,
    'clientSecret', CASE WHEN code = 'mireva-cr' THEN 'SHOPIFY_CR_CLIENT_SECRET' ELSE 'SHOPIFY_HN_CLIENT_SECRET' END
  ),
  jsonb_build_object('createdAtMin', shopify_created_at_min)
FROM stores
WHERE code IN ('mireva-cr', 'mireva-hn')
ON CONFLICT (store_id, provider) DO UPDATE SET
  secret_env_refs = EXCLUDED.secret_env_refs,
  public_config = EXCLUDED.public_config,
  updated_at = NOW();

INSERT INTO courier_accounts (store_id, courier_code, display_name, country_code, mode)
SELECT id, 'moovin', 'Moovin', country_code, 'both'
FROM stores
WHERE code = 'mireva-cr'
ON CONFLICT (store_id, courier_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  mode = EXCLUDED.mode,
  enabled = TRUE,
  updated_at = NOW();

INSERT INTO courier_accounts (store_id, courier_code, display_name, country_code, mode)
SELECT id, 'forza', 'Forza', country_code, 'both'
FROM stores
WHERE code = 'mireva-hn'
ON CONFLICT (store_id, courier_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  mode = EXCLUDED.mode,
  enabled = TRUE,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';
