-- El cruce lead<->orden ignoraba a todo lead con estado MANUAL, asi que un
-- cliente que la asesora ya habia atendido ("Contactado, dejo WhatsApp") se
-- quedaba en el tablero para siempre aunque despues comprara de verdad.
--
-- El codigo decia lo contrario. La ley 2 de nextLeadState (lib/leads-classify)
-- es explicita: "estado manual intocable, EXCEPTO una compra real nueva". El
-- SQL que detecta las compras reales se negaba a mirarlos, asi que las dos
-- mitades del sistema nunca se pusieron de acuerdo.
--
-- Medido antes del cambio en Costa Rica: 378 leads con orden real en Shopify
-- bloqueados por esa condicion, 369 visibles en el tablero y 350 con actividad
-- en los ultimos 30 dias. Casi todos (359) en "contactado_dejo_wsp".
--
-- Ahora la compra gana sobre el estado manual, con DOS excepciones que se
-- respetan a proposito:
--
--   lista_negra, cancelado_cliente, cancelado
--
-- Esas no son una lectura del embudo, son una decision de una persona sobre el
-- trato con ese cliente. Sacar a alguien de lista negra porque hizo un pedido
-- borraria justo el motivo por el que lo pusieron ahi. La lista vive tambien en
-- PURCHASE_PROOF_STATUSES (lib/leads-classify.ts): si cambia una, cambia la otra.
--
-- De paso se guarda CUAL orden fue (shopify_order_name). Antes el cruce marcaba
-- has_order = TRUE pero no dejaba rastro del pedido, asi que la columna estaba
-- vacia en los 19.796 leads y habia que ir a buscarlo por telefono.

CREATE OR REPLACE FUNCTION match_leads_to_shopify_orders(p_store_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_moved INTEGER;
BEGIN
  WITH ord AS (
    -- Telefono normalizado -> ultima orden vigente de la tienda, con su nombre.
    SELECT DISTINCT ON (regexp_replace(phone, '\D', '', 'g'))
           regexp_replace(phone, '\D', '', 'g') AS np,
           shopify_created_at                   AS last_order_at,
           name                                 AS order_name
    FROM shopify_orders
    WHERE store_id = p_store_id
      AND cancelled_at IS NULL
      AND phone IS NOT NULL
      AND phone <> ''
    ORDER BY regexp_replace(phone, '\D', '', 'g'), shopify_created_at DESC
  ),
  moved AS (
    UPDATE leads l
    SET category            = 'won',
        status              = 'pedido_generado',
        has_order           = TRUE,
        shopify_order_name  = o.order_name,
        auto_reason         = 'orden real en Shopify (cruce por telefono)'
    FROM ord o
    WHERE l.store_id = p_store_id
      -- Antes: AND l.status_source <> 'manual'  (bloqueaba TODO estado manual)
      AND l.status NOT IN ('lista_negra', 'cancelado_cliente', 'cancelado')
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
