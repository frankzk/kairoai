-- Tabla índice por PEDIDO para /api/finance/orders (Fase 1 del rediseño escalable).
--
-- Problema: hoy el endpoint baja TODO el dataset de la tienda (blob JSONB en
-- finance_dataset_cache), lo descomprime en memoria y filtra/cuenta/pagina en
-- JavaScript sobre ~15k filas. Es O(todo) por request y no escala a 100k+
-- (parse de >10MB, RAM, cold builds de minutos).
--
-- Solución: materializar por pedido los campos DERIVADOS que hoy se calculan en
-- memoria (estado efectivo, bucket del filtro, conteo de liquidación, fecha,
-- texto de búsqueda) como filas reales indexables. Con eso el endpoint filtra,
-- pagina y cuenta en SQL — O(página) sin importar el total. Aislamiento por
-- tienda: PK e índices liderados por store_id; toda consulta va con WHERE store_id.
--
-- Esta migración es ADITIVA: crea la tabla y la puebla el cron/refresh en
-- paralelo al cache actual. Nada la LEE todavía (la reescritura del endpoint es
-- la Fase 2). Si la tabla falta, el escritor es defensivo y no rompe el refresh.

-- pg_trgm habilita índices GIN de trigramas para el LIKE '%q%' de búsqueda.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS finance_order_index (
  store_id           INTEGER      NOT NULL,
  order_key          TEXT         NOT NULL,        -- row_key único del dataset
  tracking_filter    TEXT         NOT NULL,        -- pending|despacho_solicitado|...|delivered|not_delivered
  effective_status   TEXT         NOT NULL,        -- estado fusionado (para to_claim: ='delivered')
  settlement_count   INTEGER      NOT NULL DEFAULT 0,
  is_delivered       BOOLEAN      NOT NULL DEFAULT FALSE,
  order_date         DATE,                          -- YYYY-MM-DD de shopify_created_at (null si no hay)
  shopify_created_at TIMESTAMPTZ,
  cod_amount         NUMERIC      NOT NULL DEFAULT 0,
  guide_number       TEXT,
  courier            TEXT,
  match_status       TEXT,
  search_lower       TEXT         NOT NULL DEFAULT '',
  search_compact     TEXT         NOT NULL DEFAULT '',
  detail             JSONB        NOT NULL,         -- { ...row, traces } que pinta la tabla
  refreshed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, order_key)
);

-- Orden por defecto de la tabla (fecha desc). Lidera con store_id (aislamiento).
CREATE INDEX IF NOT EXISTS finance_order_index_store_created_idx
  ON finance_order_index (store_id, shopify_created_at DESC);
-- Filtro de estado (chips de seguimiento) y conteos con FILTER (...).
CREATE INDEX IF NOT EXISTS finance_order_index_store_tracking_idx
  ON finance_order_index (store_id, tracking_filter);
-- Filtro de periodo month/range sobre la fecha del pedido.
CREATE INDEX IF NOT EXISTS finance_order_index_store_date_idx
  ON finance_order_index (store_id, order_date);
-- Liquidación: settled/unsettled/to_claim/duplicate se derivan de estas dos.
CREATE INDEX IF NOT EXISTS finance_order_index_store_settlement_idx
  ON finance_order_index (store_id, settlement_count);
-- Barrido de filas viejas por refresh (delete de lo que no se re-escribió).
CREATE INDEX IF NOT EXISTS finance_order_index_store_refreshed_idx
  ON finance_order_index (store_id, refreshed_at);
-- Búsqueda libre en servidor (LIKE '%q%') sobre los dos textos materializados.
CREATE INDEX IF NOT EXISTS finance_order_index_search_lower_trgm
  ON finance_order_index USING gin (search_lower gin_trgm_ops);
CREATE INDEX IF NOT EXISTS finance_order_index_search_compact_trgm
  ON finance_order_index USING gin (search_compact gin_trgm_ops);

-- La tabla se reescribe entera en cada refresh (upsert + delete de lo viejo):
-- mismo perfil de rotación que las demás tablas financieras, así que autovacuum
-- agresivo (ver migración 0023) para que no acumule bloat.
ALTER TABLE finance_order_index SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 500,
  autovacuum_vacuum_cost_delay = 0
);

NOTIFY pgrst, 'reload schema';
