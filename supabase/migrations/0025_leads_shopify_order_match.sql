-- ============================================================
-- Kairo AI - Leads: cruce eficiente contra ordenes reales de Shopify.
--
-- Reemplaza el escaneo en memoria (que saturaba la base: cargaba TODA la
-- tabla shopify_orders en cada corrida del cron) por un match 100% en el
-- servidor: un solo UPDATE con indice. Se corre 1 vez/hora.
--
-- Regla de negocio:
--   - Un lead cuyo telefono tiene una orden NO cancelada en Shopify de la
--     misma tienda = ya compro -> se mueve a Ganados (won / pedido_generado,
--     board 'ganado', oculto). Deja de aparecer en los buckets de trabajo.
--   - Validacion temporal (evita ocultar a un cliente recurrente que hoy es
--     un lead NUEVO): solo cuenta la orden si su fecha es >= inicio de la
--     conversacion (first_seen_at) con 2 dias de holgura por zona horaria.
--   - NUNCA toca leads con status_source='manual' (Ley 1) ni los que ya
--     tienen has_order.
--
-- Telefonos: leads.phone es E.164 sin '+' (506########); shopify_orders.phone
-- viene con '+' y a veces con separadores -> se normaliza quitando no-digitos.
-- Idempotente.
-- ============================================================

-- Indice funcional para que el match sea instantaneo (no seqscan de ordenes).
-- Partial: solo ordenes vigentes con telefono cuentan.
CREATE INDEX IF NOT EXISTS shopify_orders_norm_phone_idx
  ON shopify_orders (store_id, regexp_replace(phone, '\D', '', 'g'))
  WHERE cancelled_at IS NULL AND phone IS NOT NULL AND phone <> '';

-- RPC: hace el match + move en UNA sola sentencia SQL y registra la gestion
-- en lead_calls (kind='system'). Devuelve cuantos leads se movieron.
CREATE OR REPLACE FUNCTION match_leads_to_shopify_orders(p_store_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_moved INTEGER;
BEGIN
  WITH ord AS (
    -- Telefono normalizado -> ultima orden vigente de la tienda.
    SELECT regexp_replace(phone, '\D', '', 'g') AS np,
           MAX(shopify_created_at)              AS last_order_at
    FROM shopify_orders
    WHERE store_id = p_store_id
      AND cancelled_at IS NULL
      AND phone IS NOT NULL
      AND phone <> ''
    GROUP BY 1
  ),
  moved AS (
    UPDATE leads l
    SET category    = 'won',
        status      = 'pedido_generado',
        has_order   = TRUE,
        auto_reason = 'orden real en Shopify (cruce por telefono)'
    FROM ord o
    WHERE l.store_id = p_store_id
      AND l.status_source <> 'manual'
      AND NOT l.has_order
      AND l.phone = o.np
      AND (l.first_seen_at IS NULL
           OR o.last_order_at >= l.first_seen_at - INTERVAL '2 days')
    RETURNING l.id
  ),
  ins AS (
    INSERT INTO lead_calls (lead_id, store_id, vendedora, kind, new_status, note)
    SELECT id, p_store_id, NULL, 'system', 'pedido_generado',
           'orden real en Shopify (cruce por telefono)'
    FROM moved
    RETURNING 1
  )
  SELECT count(*) INTO v_moved FROM moved;

  RETURN COALESCE(v_moved, 0);
END;
$$;

NOTIFY pgrst, 'reload schema';
