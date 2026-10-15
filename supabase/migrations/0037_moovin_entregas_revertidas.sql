-- Corrige 5 guias de Moovin guardadas como "Entregado" cuando Moovin despues
-- revirtio la entrega y las cerro como "Cancelado".
--
-- POR QUE EXISTE: los backfills de junio guardaron como estado final el evento
-- "Entregado" aunque despues vinieran otros. En estas guias Moovin marco
-- "Entregado", el paquete volvio a moverse (en 4 de las 5 regreso a la sede de
-- Moovin), hubo una incidencia y Moovin cerro la guia como "Cancelado". El
-- codigo actual toma el evento mas reciente (parseMoovinResponse) y guardaria
-- "Cancelado", pero el cron nunca vuelve a leer una guia entregada (es un
-- estado final): quedaban congeladas y el tablero contaba 4 de estos pedidos
-- como ventas entregadas. #MCRC6252 ya figuraba "No entregado" porque el
-- tablero usa su guia mas nueva (2459052, el segundo intento).
--
-- Las liquidaciones de Boxful confirman que no se cobraron (montos en colones):
--   2374688 #MCRC3424  31.840  Corte 2026-03-18: No entregado, COD 0
--   2447694 #MCRC6252  19.900  Corte 2026-06-16: No entregado, COD 0
--   2452424 #MCRC6440  31.840  Corte 2026-06-16: No entregado, COD 0
--   2480375 #MCRC8257  19.900  Corte 2026-06-16: No entregado, COD 0
--   2542452 #MCRC12618 19.900  Sin liquidacion al 18/08. El paquete volvio a la
--                              sede de Moovin 16 minutos despues del "Entregado".
-- El "pagado" de Shopify de #MCRC6440, #MCRC8257 y #MCRC12618 no prueba cobro:
-- se marca solo con el "Entregado" de Moovin y no se revierte.
--
-- A PROPOSITO NO se tocan 2380362 (#MCRC3520) ni 2437729 (#MCRC5618). Tienen el
-- mismo patron, pero Boxful les liquido el COD (19.900 cada una, cortes del
-- 2026-06-16 y 2026-06-23). Pasarlas a "No entregado" haria que el tablero
-- negara dos ventas que se cobraron. Si alguna vez se re-sincronizan, van a
-- pasar a "No entregado".
--
-- Deja cada fila EXACTAMENTE como la guardaria una re-sincronizacion con el
-- codigo actual:
-- - Estado final = evento mas reciente: Cancelado / CANCEL / returned.
-- - Sin incidencia activa, porque el ultimo evento no es una falla.
-- - El grupo de cada evento se recalcula con classifyMoovinGroup; el CASE de
--   abajo se verifico contra el clasificador real.
-- - Cambian tres grupos de eventos del historial:
--     2374688 DELIVEREDCOMPLETE  in_progress -> delivered
--     2374688 CHANGECONTACTPOINT in_progress -> failed
--     2542452 CHANGECONTACTPOINT in_progress -> failed
-- - No toca checked_at: la guia no se volvio a leer de Moovin.
-- Ninguna de las 5 tiene novedades, asi que Novedades no cambia.
--
-- Para revertir, volver cada guia a su estado anterior y esos tres grupos de
-- eventos a 'in_progress':
--   2374688  Entrega completa / DELIVEREDCOMPLETE / delivered / 2026-03-10 22:48:55+00
--   2447694  Entregado por el Moover / DELIVERED / delivered / 2026-04-28 20:19:09+00
--   2452424  Entregado por el Moover / DELIVERED / delivered / 2026-05-07 19:42:50+00
--   2480375  Entregado por el Moover / DELIVERED / delivered / 2026-05-20 16:47:54+00
--   2542452  Entregado por el Moover / DELIVERED / delivered / 2026-06-26 22:52:00+00
-- (has_incident = false e incident_reason = '' ya estaban asi).
WITH objetivo AS (
  SELECT m.id_package,
         (SELECT e FROM jsonb_array_elements(m.events) AS e
           ORDER BY e->>'date' DESC NULLS LAST
           LIMIT 1) AS ultimo
  FROM moovin_tracking m
  WHERE m.id_package IN ('2374688', '2447694', '2452424', '2480375', '2542452')
    AND m.latest_group = 'delivered'
)
UPDATE moovin_tracking m
SET latest_status   = o.ultimo->>'title',
    latest_code     = o.ultimo->>'code',
    latest_group    = 'returned',
    latest_at       = (o.ultimo->>'date')::timestamptz,
    has_incident    = FALSE,
    incident_reason = '',
    events = (
      SELECT jsonb_agg(
               jsonb_set(t.e, '{group}', to_jsonb(CASE
                 WHEN upper(t.e->>'code') IN ('DELIVERED', 'DELIVEREDCOMPLETE') THEN 'delivered'
                 WHEN upper(t.e->>'code') IN ('FAILED', 'REVIEW', 'CHANGECONTACTPOINT') THEN 'failed'
                 WHEN upper(t.e->>'code') IN ('RETURNED', 'RETURN', 'RETURNTOSENDER', 'CANCELED', 'CANCELLED', 'CANCEL') THEN 'returned'
                 WHEN lower(t.e->>'title') LIKE '%cancelado%' THEN 'returned'
                 ELSE 'in_progress'
               END))
               ORDER BY t.ord)
      FROM jsonb_array_elements(m.events) WITH ORDINALITY AS t(e, ord)
    )
FROM objetivo o
WHERE m.id_package = o.id_package
  AND upper(o.ultimo->>'code') LIKE 'CANCEL%';
