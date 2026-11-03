-- TikTok Ads por ANUNCIO y por dia (03/11/2026), para la Matriz 4Pi de
-- Marketing (Charlie), con el mismo detalle que lee de Meta: gasto,
-- impresiones, clics, frecuencia, compras, valor de compras e interacciones.
--
-- Lo manda el escenario de Make "CR|KENKU HEAL1010" a
-- POST /api/marketing/tiktok-anuncios. La llave por dia y anuncio hace que el
-- reenvio de un dia lo reemplace en vez de duplicarlo.
--
-- Solo el servidor la lee y escribe (service role): RLS sin politicas.

CREATE TABLE IF NOT EXISTS tiktok_anuncios_diario (
  store_id        BIGINT      NOT NULL,
  advertiser_id   TEXT        NOT NULL,
  advertiser_name TEXT        NOT NULL DEFAULT '',
  ad_id           TEXT        NOT NULL,
  ad_name         TEXT        NOT NULL DEFAULT '',
  adgroup_id      TEXT        NOT NULL DEFAULT '',
  adgroup_name    TEXT        NOT NULL DEFAULT '',
  campaign_id     TEXT        NOT NULL DEFAULT '',
  campaign_name   TEXT        NOT NULL DEFAULT '',
  fecha           DATE        NOT NULL,
  spend           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  impressions     INTEGER     NOT NULL DEFAULT 0,
  clicks          INTEGER     NOT NULL DEFAULT 0,
  frequency       NUMERIC(8, 3),
  purchases       INTEGER     NOT NULL DEFAULT 0,
  purchase_value  NUMERIC(14, 2),
  interactions    INTEGER     NOT NULL DEFAULT 0,
  currency        TEXT        NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, advertiser_id, ad_id, fecha)
);

CREATE INDEX IF NOT EXISTS tiktok_anuncios_diario_fecha_idx ON tiktok_anuncios_diario (store_id, fecha);

ALTER TABLE tiktok_anuncios_diario ENABLE ROW LEVEL SECURITY;
