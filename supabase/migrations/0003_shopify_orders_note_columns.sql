-- Promueve note/note_attributes a columnas reales y rellena line_items para
-- que las lecturas no extraigan campos de raw_order (detoast de JSONB enorme
-- por fila = "canceling statement due to statement timeout" con 10k+ pedidos).

ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS note_attributes JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE shopify_orders
SET
  note = COALESCE(raw_order->>'note', ''),
  note_attributes = COALESCE(raw_order->'note_attributes', '[]'::jsonb),
  line_items = CASE
    WHEN jsonb_array_length(COALESCE(line_items, '[]'::jsonb)) = 0
      THEN COALESCE(raw_order->'line_items', '[]'::jsonb)
    ELSE line_items
  END;
