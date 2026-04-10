-- ============================================================
-- Kairo AI — Supabase Schema
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- Tabla principal de llamadas
CREATE TABLE IF NOT EXISTS calls (
  id            BIGSERIAL PRIMARY KEY,
  call_id       TEXT        UNIQUE NOT NULL,
  order_id      TEXT        NOT NULL,
  phone         TEXT        NOT NULL,
  customer_name TEXT        NOT NULL DEFAULT '',
  products      TEXT        NOT NULL DEFAULT '',
  total         TEXT        NOT NULL DEFAULT '',
  country       TEXT        NOT NULL DEFAULT 'CR',
  status        TEXT        NOT NULL DEFAULT 'calling'
                CHECK (status IN ('calling','confirmed','cancelled','no_answer','upsell_accepted','error')),
  upsell_accepted BOOLEAN   NOT NULL DEFAULT FALSE,
  duration_seconds INTEGER  NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calls_started_at_idx ON calls (started_at DESC);
CREATE INDEX IF NOT EXISTS calls_call_id_idx    ON calls (call_id);
CREATE INDEX IF NOT EXISTS calls_status_idx     ON calls (status);

-- Deduplicación (reemplaza Redis TTL keys)
CREATE TABLE IF NOT EXISTS call_dedup (
  key        TEXT        PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Cola de reintentos (reemplaza Redis sorted set)
CREATE TABLE IF NOT EXISTS retry_queue (
  id           BIGSERIAL   PRIMARY KEY,
  phone        TEXT        NOT NULL,
  order_id     TEXT        NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  processed    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retry_queue_scheduled_idx
  ON retry_queue (scheduled_at) WHERE NOT processed;

-- Reglas de upsell (configurables desde el dashboard)
CREATE TABLE IF NOT EXISTS upsell_rules (
  id           BIGSERIAL   PRIMARY KEY,
  trigger_sku  TEXT        NOT NULL,
  upsell_sku   TEXT        NOT NULL,
  upsell_name  TEXT        NOT NULL,
  upsell_price INTEGER     NOT NULL, -- en Colones (₡)
  pitch        TEXT        NOT NULL,
  tier         TEXT        NOT NULL DEFAULT 'B'
               CHECK (tier IN ('S', 'A', 'B')),
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS upsell_rules_trigger_idx ON upsell_rules (trigger_sku) WHERE active;

-- Configuración del agente (única fila con id=1)
CREATE TABLE IF NOT EXISTS agent_settings (
  id                   INTEGER     PRIMARY KEY DEFAULT 1,
  max_retries          INTEGER     NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 1 AND 5),
  retry_delay_minutes  INTEGER     NOT NULL DEFAULT 30 CHECK (retry_delay_minutes >= 1),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO agent_settings (id, max_retries, retry_delay_minutes)
  VALUES (1, 3, 30) ON CONFLICT (id) DO NOTHING;

-- Campo de producto upsell en llamadas (nombre del producto ofrecido)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS upsell_product TEXT;

-- Campo de número de intento en retry_queue
ALTER TABLE retry_queue ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;

-- Nuevos campos de configuración del agente (per-attempt delays + agente de carritos)
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS retry_delays        JSONB   DEFAULT '[30, 120, 240]'::jsonb;
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS cart_agent_enabled  BOOLEAN DEFAULT FALSE;
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS cart_agent_name     TEXT    DEFAULT '';
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS cart_agent_phone    TEXT    DEFAULT '';
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS cart_agent_retell_id TEXT   DEFAULT '';
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS cart_agent_retry_delays JSONB DEFAULT '[60, 240]'::jsonb;

-- Refrescar caché de PostgREST después de cambios de esquema
NOTIFY pgrst, 'reload schema';

-- Limpieza automática de dedup expirados (opcional, requiere pg_cron)
-- SELECT cron.schedule('cleanup-dedup', '0 * * * *',
--   'DELETE FROM call_dedup WHERE expires_at < NOW()');
