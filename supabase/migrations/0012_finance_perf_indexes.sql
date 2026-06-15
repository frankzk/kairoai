-- Indices para los escaneos ordenados del armado del dataset server-side
-- (Carril 2). listLogisticsRows / listSettlementRows filtran por store_id y
-- ordenan por created_on DESC; sin indice compuesto, Postgres ordena la tienda
-- entera en cada build. Baratos y de bajo riesgo (~miles de filas hoy, pero
-- importan al escalar a varias tiendas).

CREATE INDEX IF NOT EXISTS logistics_rows_store_created_on_idx
  ON logistics_rows (store_id, created_on DESC);

CREATE INDEX IF NOT EXISTS settlement_rows_store_created_on_idx
  ON settlement_rows (store_id, created_on DESC);

-- El match materializado (logistics_rows.shopify_order_id) habilita el join
-- por FK que usara la version SQL del armado de pedidos (palanca 1).
CREATE INDEX IF NOT EXISTS logistics_rows_store_shopify_order_id_idx
  ON logistics_rows (store_id, shopify_order_id);
