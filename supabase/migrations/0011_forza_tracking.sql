-- Cache de tracking Forza por tienda. Honduras usa Forza como transportadora
-- principal; Costa Rica conserva Moovin en su tabla propia.

CREATE TABLE IF NOT EXISTS forza_tracking (
  store_id         BIGINT       NOT NULL DEFAULT 2,
  guide_number     TEXT         NOT NULL,
  tracking_number  TEXT         NOT NULL DEFAULT '',
  latest_status    TEXT         NOT NULL DEFAULT '',
  latest_code      TEXT         NOT NULL DEFAULT '',
  latest_group     TEXT         NOT NULL DEFAULT '',
  latest_at        TIMESTAMPTZ,
  has_incident     BOOLEAN      NOT NULL DEFAULT FALSE,
  incident_reason  TEXT         NOT NULL DEFAULT '',
  delivery_address TEXT         NOT NULL DEFAULT '',
  receiver_name    TEXT         NOT NULL DEFAULT '',
  events           JSONB        NOT NULL DEFAULT '[]'::jsonb,
  checked_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, guide_number)
);

CREATE INDEX IF NOT EXISTS forza_tracking_checked_idx ON forza_tracking (store_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS forza_tracking_group_idx ON forza_tracking (store_id, latest_group);
CREATE INDEX IF NOT EXISTS forza_tracking_incident_idx ON forza_tracking (store_id, has_incident);

NOTIFY pgrst, 'reload schema';
