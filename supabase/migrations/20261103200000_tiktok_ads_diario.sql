-- Gasto diario de TikTok Ads por campaña (03/11/2026).
--
-- Lo manda el escenario de Make "CR|KENKU HEAL1010" (el mismo que escribe el
-- Sheets "Mireva Costa Rica" > Ads Tracker) a POST /api/marketing/tiktok-diario.
-- Make trae ayer y anteayer en cada corrida: la llave por dia y campaña hace
-- que el segundo envio REEMPLACE al primero en vez de duplicar el gasto.
-- Se usa en Marketing como fuente de TikTok mientras no haya acceso directo a
-- la API (la app de desarrollador de TikTok fue rechazada).
--
-- Solo el servidor la lee y escribe (service role): RLS sin politicas.

CREATE TABLE IF NOT EXISTS tiktok_ads_diario (
  store_id        BIGINT      NOT NULL,
  advertiser_id   TEXT        NOT NULL,
  advertiser_name TEXT        NOT NULL DEFAULT '',
  campaign_id     TEXT        NOT NULL,
  campaign_name   TEXT        NOT NULL DEFAULT '',
  fecha           DATE        NOT NULL,
  spend           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  clicks          INTEGER     NOT NULL DEFAULT 0,
  impressions     INTEGER,
  conversions     INTEGER,
  currency        TEXT        NOT NULL,
  timezone        TEXT        NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, advertiser_id, campaign_id, fecha)
);

CREATE INDEX IF NOT EXISTS tiktok_ads_diario_fecha_idx ON tiktok_ads_diario (store_id, fecha);

ALTER TABLE tiktok_ads_diario ENABLE ROW LEVEL SECURITY;
