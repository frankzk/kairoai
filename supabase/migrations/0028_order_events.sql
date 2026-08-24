-- Bitacora de gestion por pedido: intentos de contacto, notas y decisiones que
-- toma la asesora ANTES de despachar. Append-only, misma forma que
-- incident_events (0016), que ya funciona bien para Novedades.
--
-- No referencia shopify_orders por id: la llave operativa es el numero de
-- pedido visible (#MCRC20367), que es lo que la asesora ve y busca, y que
-- sobrevive a un re-sync de Shopify.

CREATE TABLE IF NOT EXISTS order_events (
  id            BIGSERIAL    PRIMARY KEY,
  store_id      BIGINT       NOT NULL,
  order_name    TEXT         NOT NULL,
  guide_number  TEXT         NOT NULL DEFAULT '',
  kind          TEXT         NOT NULL CHECK (kind IN ('contacto','nota','decision')),
  -- Resultado del intento (kind='contacto') o la decision tomada
  -- (kind='decision'). Vacio para las notas.
  outcome       TEXT         NOT NULL DEFAULT '' CHECK (outcome IN (
                               '',
                               'contesto','no_contesta','buzon','numero_malo',
                               'confirmado','reagendar',
                               'autorizar_despacho','retener','anular'
                             )),
  message       TEXT         NOT NULL DEFAULT '',
  staff_id      BIGINT,
  staff_name    TEXT         NOT NULL DEFAULT '',
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- La consulta del drawer: los eventos de UN pedido, mas reciente primero.
CREATE INDEX IF NOT EXISTS order_events_order_idx
  ON order_events (store_id, order_name, created_at DESC);

-- Para la cola de trabajo: "que pedidos toque hoy" sin escanear la tabla.
CREATE INDEX IF NOT EXISTS order_events_store_created_idx
  ON order_events (store_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
