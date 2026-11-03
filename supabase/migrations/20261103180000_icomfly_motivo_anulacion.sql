-- Motivo de anulacion de iComfly en icomfly_orders (03/11/2026).
--
-- Para medir bien la tasa de confirmacion: los anulados por Duplicado, Numero
-- errado, Producto agotado, Lista negra, Error en el pedido (cambio en la
-- orden), Fraude o reemplazo por upsell no son rechazos del cliente y no
-- cuentan (lib/anulacion-motivos.ts decide cuales).
--
-- El sync de iComfly (lib/icomfly-sync.ts) llena las dos columnas en cada
-- pasada; aqui se completan las que ya estaban desde el pedido completo
-- guardado (icomfly_order_payloads).

ALTER TABLE icomfly_orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

UPDATE icomfly_orders o
   SET cancelled_at = CASE
         WHEN p.payload->>'cancelled_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (p.payload->>'cancelled_at')::timestamptz
       END,
       cancellation_reason = NULLIF(btrim(p.payload->>'cancellation_reason'), '')
  FROM icomfly_order_payloads p
 WHERE p.store_id = o.store_id
   AND p.icomfly_order_id = o.icomfly_order_id
   AND (p.payload->>'cancelled_at' IS NOT NULL OR p.payload->>'cancellation_reason' IS NOT NULL);

CREATE INDEX IF NOT EXISTS icomfly_orders_cancelled_idx
  ON icomfly_orders (store_id, cancelled_at)
  WHERE cancelled_at IS NOT NULL;
