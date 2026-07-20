-- Seguimiento WYN por tienda. Costa Rica puede operar Moovin y WYN a la vez;
-- la transportadora se determina por la guia, sin crear pedidos adicionales.

CREATE TABLE IF NOT EXISTS wyn_tracking (
  store_id BIGINT NOT NULL DEFAULT 1,
  guide_number TEXT NOT NULL,
  tracking_number TEXT NOT NULL DEFAULT '',
  latest_status TEXT NOT NULL DEFAULT '',
  latest_code TEXT NOT NULL DEFAULT '',
  latest_group TEXT NOT NULL DEFAULT '',
  latest_at TIMESTAMPTZ,
  has_incident BOOLEAN NOT NULL DEFAULT FALSE,
  incident_reason TEXT NOT NULL DEFAULT '',
  delivery_address TEXT NOT NULL DEFAULT '',
  receiver_name TEXT NOT NULL DEFAULT '',
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, guide_number),
  CONSTRAINT wyn_tracking_store_fk
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS wyn_tracking_checked_idx
  ON wyn_tracking (store_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS wyn_tracking_group_idx
  ON wyn_tracking (store_id, latest_group);
CREATE INDEX IF NOT EXISTS wyn_tracking_incident_idx
  ON wyn_tracking (store_id, has_incident)
  WHERE has_incident = TRUE;

NOTIFY pgrst, 'reload schema';
