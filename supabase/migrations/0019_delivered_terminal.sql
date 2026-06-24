-- "Entregado" es terminal: una guia con un evento delivered no debe revertir a
-- Recolectado/Preccoordinacion aunque el courier emita un evento posterior con
-- fecha mas nueva. La logica de calculo del estado (lib/moovin.ts, lib/forza.ts)
-- ya hace prevalecer delivered al escribir; este backfill corrige las filas YA
-- guardadas recomputando latest_*/has_incident desde el events JSONB existente
-- (sin llamar a la API del courier), solo donde hay un evento delivered pero el
-- latest_group quedo en otro estado.

-- Moovin (PK id_package)
UPDATE moovin_tracking m
SET latest_group   = 'delivered',
    latest_status  = COALESCE(d.elem->>'title', m.latest_status),
    latest_code    = COALESCE(d.elem->>'code', m.latest_code),
    latest_at      = COALESCE(NULLIF(d.elem->>'date', '')::timestamptz, m.latest_at),
    has_incident   = FALSE,
    incident_reason = ''
FROM (
  SELECT m2.id_package,
    (SELECT elem FROM jsonb_array_elements(m2.events) elem
     WHERE elem->>'group' = 'delivered'
     ORDER BY elem->>'date' DESC NULLS LAST LIMIT 1) AS elem
  FROM moovin_tracking m2
) d
WHERE m.id_package = d.id_package
  AND d.elem IS NOT NULL
  AND m.latest_group <> 'delivered';

-- Forza (PK store_id + guide_number)
UPDATE forza_tracking f
SET latest_group   = 'delivered',
    latest_status  = COALESCE(d.elem->>'title', f.latest_status),
    latest_code    = COALESCE(d.elem->>'code', f.latest_code),
    latest_at      = COALESCE(NULLIF(d.elem->>'date', '')::timestamptz, f.latest_at),
    has_incident   = FALSE,
    incident_reason = ''
FROM (
  SELECT f2.store_id, f2.guide_number,
    (SELECT elem FROM jsonb_array_elements(f2.events) elem
     WHERE elem->>'group' = 'delivered'
     ORDER BY elem->>'date' DESC NULLS LAST LIMIT 1) AS elem
  FROM forza_tracking f2
) d
WHERE f.store_id = d.store_id
  AND f.guide_number = d.guide_number
  AND d.elem IS NOT NULL
  AND f.latest_group <> 'delivered';

NOTIFY pgrst, 'reload schema';
