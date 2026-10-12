-- Descarta 73 novedades de Honduras que no se pueden gestionar: pedidos de
-- enero a marzo de 2026 cuya guia de Forza quedo en "Creado" (Forza nunca
-- recibio el paquete). 29 de esos pedidos estan cancelados en Shopify.
--
-- POR QUE EXISTE: entraron como "Demora en entrega" el 15/09, cuando la regla de
-- demora de Costa Rica (14 dias desde el pedido) se aplico tambien a Honduras y
-- encontro guias viejas sin movimiento. Nadie va a llamar por un pedido de
-- enero, y llenaban un tercio de la bandeja de Honduras. Las reglas nuevas de
-- Honduras (lib/forza-novedades.ts) ya no generan novedades de pedidos de mas
-- de 60 dias ni de pedidos cancelados.
--
-- A PROPOSITO NO se tocan otras 76 novedades abiertas de pedidos de mas de 60
-- dias (julio y agosto, y paquetes "En instalaciones" desde febrero): pueden
-- ser paquetes que siguen en bodegas de Forza, con mercaderia para recuperar.
-- Quedan para decidir aparte.
--
-- Deja el mismo rastro que el boton "Descartar" del modulo: estado descartada,
-- manual_override (la deteccion no la vuelve a tocar) y un evento "descartada"
-- en el historial. Ensayado en seco el 12/10: 73 filas, todas "pendiente" y
-- ninguna con llamadas, notas ni reprogramaciones.
--
-- Para revertir: volver a 'pendiente' las novedades con un evento "descartada"
-- cuyo mensaje empiece con "Limpieza de Honduras" y borrar esos eventos.
WITH objetivo AS (
  SELECT i.id, i.status
  FROM incidents i
  LEFT JOIN shopify_orders s ON s.store_id = 2 AND s.name = i.order_name
  WHERE i.store_id = 2
    AND i.status NOT IN ('resuelta', 'perdida', 'descartada')
    AND i.last_tracking_status = 'Creado'
    AND COALESCE(
          s.shopify_created_at,
          (SELECT min((e->>'date')::timestamptz)
             FROM forza_tracking t, jsonb_array_elements(t.events) e
            WHERE t.store_id = 2
              AND upper(t.guide_number) = upper(i.guide_number)
              AND e->>'title' = 'Creado')
        ) < '2026-04-01'
),
descartadas AS (
  UPDATE incidents i
  SET status = 'descartada', manual_override = TRUE, updated_at = now()
  FROM objetivo o
  WHERE i.id = o.id
  RETURNING i.id, o.status AS from_status
)
INSERT INTO incident_events (incident_id, kind, from_status, to_status, message, result, metadata)
SELECT id, 'descartada', from_status, 'descartada',
       'Limpieza de Honduras: pedido de enero a marzo y Forza nunca recibio el paquete (guia en "Creado")',
       'ok', '{}'::jsonb
FROM descartadas;
