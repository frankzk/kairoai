-- Cache del ultimo estado de Moovin por guia, para no consultar la API en cada
-- carga. Se llena bajo demanda (boton de la fila) y por lote (pedidos en ruta).

CREATE TABLE IF NOT EXISTS moovin_tracking (
  id_package        TEXT         PRIMARY KEY,
  last_name         TEXT         NOT NULL DEFAULT '',
  tracking_number   TEXT         NOT NULL DEFAULT '',
  latest_status     TEXT         NOT NULL DEFAULT '',
  latest_code       TEXT         NOT NULL DEFAULT '',
  latest_group      TEXT         NOT NULL DEFAULT '',
  latest_at         TIMESTAMPTZ,
  has_incident      BOOLEAN      NOT NULL DEFAULT FALSE,
  incident_reason   TEXT         NOT NULL DEFAULT '',
  delivery_address  TEXT         NOT NULL DEFAULT '',
  events            JSONB        NOT NULL DEFAULT '[]'::jsonb,
  checked_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS moovin_tracking_incident_idx ON moovin_tracking (has_incident);
CREATE INDEX IF NOT EXISTS moovin_tracking_group_idx ON moovin_tracking (latest_group);
