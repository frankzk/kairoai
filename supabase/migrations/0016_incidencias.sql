-- Modulo de Gestion de Novedades (incidencias de reparto): pedidos que salieron
-- a reparto y no se lograron entregar. Multi-tienda: cada novedad pertenece a una
-- tienda (stores.id). Se alimenta de forma automatica (cache de Moovin para Costa
-- Rica; Forza para Honduras) y manual, y registra el seguimiento del operador
-- (llamadas, reprogramaciones, cierre) con historial.

CREATE TABLE IF NOT EXISTS incidents (
  id                   BIGSERIAL     PRIMARY KEY,
  -- Tienda dueña de la novedad (multi-tienda: Costa Rica / Honduras).
  store_id             BIGINT        NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  -- Clave idempotente que unifica auto (Moovin/Forza/Boxful) + manual del mismo
  -- envio, DENTRO de una tienda.
  incident_key         TEXT          NOT NULL,
  source               TEXT          NOT NULL DEFAULT 'manual'
                                     CHECK (source IN ('moovin','forza','boxful','manual')),
  -- Referencias planas al pedido (no son FK; el cruce es por texto, como en el
  -- resto del sistema).
  order_name           TEXT          NOT NULL DEFAULT '',
  guide_number         TEXT          NOT NULL DEFAULT '',
  shopify_order_id     TEXT          NOT NULL DEFAULT '',
  customer_name        TEXT          NOT NULL DEFAULT '',
  customer_phone       TEXT          NOT NULL DEFAULT '',
  courier              TEXT          NOT NULL DEFAULT '',
  cod_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Causa de la novedad.
  category             TEXT          NOT NULL DEFAULT 'otro'
                                     CHECK (category IN (
                                       'fallo_entrega','direccion_incorrecta','cliente_no_responde',
                                       'cliente_rechaza','devuelto_origen','dano_paquete','otro')),
  -- Estado de gestion (colorimetria).
  status               TEXT          NOT NULL DEFAULT 'pendiente'
                                     CHECK (status IN (
                                       'pendiente','reprogramada','sin_contestar','no_llamar',
                                       'resuelta','perdida','descartada')),
  detail               TEXT          NOT NULL DEFAULT '',  -- razon cruda de Moovin/Forza/Boxful
  notes                TEXT          NOT NULL DEFAULT '',  -- notas del operador
  reprogramada_para    DATE,
  intentos_llamada     INT           NOT NULL DEFAULT 0,
  ultimo_intento_at    TIMESTAMPTZ,
  -- Snapshot del tracking que origino/actualizo la novedad.
  last_tracking_status TEXT          NOT NULL DEFAULT '',
  last_tracking_group  TEXT          NOT NULL DEFAULT '',
  -- True si el operador toco la novedad: la deteccion automatica no la pisa.
  manual_override      BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Idempotencia POR TIENDA: la misma guia en distintas tiendas no colisiona.
  CONSTRAINT incidents_store_key_uk UNIQUE (store_id, incident_key)
);

CREATE INDEX IF NOT EXISTS incidents_store_status_idx  ON incidents (store_id, status);
CREATE INDEX IF NOT EXISTS incidents_store_updated_idx ON incidents (store_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS incidents_category_idx      ON incidents (category);
CREATE INDEX IF NOT EXISTS incidents_order_idx         ON incidents (order_name);
CREATE INDEX IF NOT EXISTS incidents_guide_idx         ON incidents (guide_number);

-- Historial append-only de cambios de estado y acciones correctivas.
CREATE TABLE IF NOT EXISTS incident_events (
  id            BIGSERIAL    PRIMARY KEY,
  incident_id   BIGINT       NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind          TEXT         NOT NULL CHECK (kind IN (
                               'detectada','estado_cambiado','categoria_cambiada','nota',
                               'llamada','reprogramada','no_llamar',
                               'accion_rts','accion_cancelar_shopify','descartada')),
  from_status   TEXT         NOT NULL DEFAULT '',
  to_status     TEXT         NOT NULL DEFAULT '',
  message       TEXT         NOT NULL DEFAULT '',
  result        TEXT         NOT NULL DEFAULT 'ok' CHECK (result IN ('ok','error','info')),
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS incident_events_incident_idx ON incident_events (incident_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
