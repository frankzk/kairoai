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

-- Limpieza automática de dedup expirados (opcional, requiere pg_cron)
-- SELECT cron.schedule('cleanup-dedup', '0 * * * *',
--   'DELETE FROM call_dedup WHERE expires_at < NOW()');
