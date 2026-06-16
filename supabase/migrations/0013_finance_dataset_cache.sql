-- Cache durable y compartida del dataset ensamblado de finanzas (Palanca 1).
-- buildDataset (en app/api/finance/_shared/orders-dataset.ts) carga ~11k pedidos
-- + logistica + moovin/forza + liquidaciones y los ensambla: un "cold build" de
-- 5-15s que hoy se repite por instancia serverless (cache solo en memoria, 30s).
--
-- Esta tabla guarda el payload ya ensamblado por tienda como una sola fila, para
-- que el armado pesado corra en background (cron + tras mutaciones) y NO en el
-- path del request: leer el dataset pasa a ser un fetch de una fila + deserializar,
-- compartido entre todas las instancias.
--
-- Es cache interna (se accede via service-role con getDB(), igual que el resto de
-- tablas de finanzas), no requiere RLS. Si la tabla falta o el acceso falla, el
-- codigo cae a ensamblar en memoria (nunca rompe el dashboard).

CREATE TABLE IF NOT EXISTS finance_dataset_cache (
  store_id     INTEGER     PRIMARY KEY,
  payload      JSONB       NOT NULL,
  row_count    INTEGER     NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

NOTIFY pgrst, 'reload schema';
