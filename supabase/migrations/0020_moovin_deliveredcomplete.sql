-- Corrige las guias de Moovin cerradas con "Entrega completa" (DELIVEREDCOMPLETE)
-- que quedaron guardadas como "en curso".
--
-- POR QUE EXISTE: classifyMoovinGroup no conocia el codigo DELIVEREDCOMPLETE, asi
-- que esas entregas se guardaban con latest_group = 'in_progress'. El arreglo de
-- codigo (lib/moovin.ts) corrige todo lo que se sincronice de aca en adelante,
-- pero NO alcanza a las filas ya guardadas: el cron solo re-lee las guias de
-- pedidos de los ultimos 45 dias (listMoovinSyncCandidates), y estas son de
-- julio. Sin esta correccion quedarian congeladas como "en curso" para siempre:
-- figurando "No entregado" en finanzas y como demora en Novedades.
--
-- Deja cada fila EXACTAMENTE como la guardaria una re-sincronizacion con el
-- codigo arreglado: latest_group = 'delivered' y el grupo del evento
-- DELIVEREDCOMPLETE dentro del historial. has_incident / incident_reason ya
-- estaban en false / '' (solo se activan si el ultimo evento es una falla); se
-- fijan igual por si la migracion se corre sobre otra base.
--
-- Afectaba 2 filas al 23/09 (ensayadas en seco: mismo largo y orden de eventos,
-- unico cambio el grupo de ese evento):
--   2591135 (#MCRC16612): in_progress, 15 eventos
--   2607543 (#MCRC17995): in_progress, 11 eventos
-- Para revertir: volver latest_group a 'in_progress' en esas dos guias y el
-- grupo de su evento DELIVEREDCOMPLETE a 'in_progress'.
UPDATE moovin_tracking m
SET latest_group    = 'delivered',
    has_incident    = FALSE,
    incident_reason = '',
    events = COALESCE((
      SELECT jsonb_agg(
               CASE WHEN upper(e->>'code') = 'DELIVEREDCOMPLETE'
                    THEN jsonb_set(e, '{group}', '"delivered"')
                    ELSE e END
               ORDER BY t.ord)
      FROM jsonb_array_elements(m.events) WITH ORDINALITY AS t(e, ord)
    ), m.events)
WHERE upper(m.latest_code) = 'DELIVEREDCOMPLETE'
  AND m.latest_group <> 'delivered';
