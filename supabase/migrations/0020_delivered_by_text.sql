-- Rescate de entregas con codigo/titulo no estandar ("Entrega completa"): esas
-- filas quedaron con latest_group != 'delivered' porque classifyMoovinGroup solo
-- reconocia el codigo DELIVERED (o el titulo "Entregado por el Moover"). Ahora la
-- clasificacion tambien detecta la entrega por texto (titulo "Entrega completa" /
-- "Entregado", o la descripcion "...ha sido entregado en la direccion de destino").
-- Este backfill recomputa latest_*/has_incident de las filas YA guardadas desde el
-- events JSONB (sin llamar a la API), detectando la entrega por texto. Complementa
-- 0019_delivered_terminal.sql, que solo cubria eventos ya etiquetados group='delivered'.

UPDATE moovin_tracking m
SET latest_group    = 'delivered',
    latest_status   = COALESCE(d.elem->>'title', m.latest_status),
    latest_code     = COALESCE(d.elem->>'code', m.latest_code),
    latest_at       = COALESCE(NULLIF(d.elem->>'date', '')::timestamptz, m.latest_at),
    has_incident    = FALSE,
    incident_reason = ''
FROM (
  SELECT m2.id_package,
    (SELECT elem FROM jsonb_array_elements(m2.events) elem
     WHERE lower(elem->>'title') LIKE '%entrega completa%'
        OR (lower(elem->>'title') LIKE '%entregado%' AND lower(elem->>'title') NOT LIKE '%no entreg%')
        OR lower(elem->>'description') LIKE '%ha sido entregado%'
     ORDER BY elem->>'date' DESC NULLS LAST LIMIT 1) AS elem
  FROM moovin_tracking m2
) d
WHERE m.id_package = d.id_package
  AND d.elem IS NOT NULL
  AND m.latest_group <> 'delivered';

NOTIFY pgrst, 'reload schema';
