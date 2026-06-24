-- Estado de despacho a partir de iComfly.
--
-- Captura, por pedido, dos momentos atribuibles a personas de la planilla:
--   (1) quien CONFIRMA el pedido           -> atribucion.confirmo
--   (2) quien SOLICITA el despacho/guia     -> atribucion.genero_guia | envio
-- y el cierre del almacen (guia final), que se mide "hecho + cuando" (sin
-- persona, porque ShipHero/Boxful no expone usuario hacia kairoai).
--
-- Diseno multi-tienda / multi-courier / multi-usuario: cada fila lleva
-- store_id, carrier_name y los user_id/staff_id de quien actuo.

-- ─── Planilla: enriquecer para enlazar identidad de iComfly ──────────────────
-- Hoy payroll_staff solo tiene name (indice unico por lower(name)). Para un
-- match robusto con la atribucion de iComfly agregamos correo y user_id.
ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS email           TEXT;
ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS icomfly_user_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS payroll_staff_icomfly_user_idx
  ON payroll_staff (icomfly_user_id) WHERE icomfly_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payroll_staff_email_idx
  ON payroll_staff (lower(email)) WHERE email IS NOT NULL;

-- ─── Catalogo de agentes de iComfly (/metrics/agents) ────────────────────────
-- Alimenta el match (user_id/nombre/correo) y el reporte de productividad.
CREATE TABLE IF NOT EXISTS icomfly_agents (
  store_id    BIGINT       NOT NULL,
  user_id     BIGINT       NOT NULL,
  name        TEXT         NOT NULL DEFAULT '',
  email       TEXT         NOT NULL DEFAULT '',
  staff_id    BIGINT       REFERENCES payroll_staff(id) ON DELETE SET NULL,
  metrics     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  synced_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_id, user_id)
);

-- ─── Pedidos de iComfly con estado de despacho + atribucion ──────────────────
CREATE TABLE IF NOT EXISTS icomfly_orders (
  store_id               BIGINT       NOT NULL,
  icomfly_order_id       TEXT         NOT NULL,
  order_number           TEXT         NOT NULL DEFAULT '',
  shopify_display_number TEXT         NOT NULL DEFAULT '',
  status                 TEXT         NOT NULL DEFAULT '',
  carrier_name           TEXT         NOT NULL DEFAULT '',
  tracking_number        TEXT         NOT NULL DEFAULT '',
  shipped_at             TIMESTAMPTZ,
  icomfly_created_at     TIMESTAMPTZ,

  -- Sub-estado de despacho: pendiente | despacho_solicitado | despachado
  dispatch_state         TEXT         NOT NULL DEFAULT 'pendiente',
  is_standby             BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Quien confirmo el pedido (asesora -> planilla)
  confirmed_by_user_id   BIGINT,
  confirmed_by_name      TEXT         NOT NULL DEFAULT '',
  confirmed_by_email     TEXT         NOT NULL DEFAULT '',
  confirmed_at           TIMESTAMPTZ,
  confirmed_by_staff_id  BIGINT       REFERENCES payroll_staff(id) ON DELETE SET NULL,

  -- Quien solicito el despacho / genero la guia de transporte (asesora -> planilla)
  requested_by_user_id   BIGINT,
  requested_by_name      TEXT         NOT NULL DEFAULT '',
  requested_by_email     TEXT         NOT NULL DEFAULT '',
  requested_at           TIMESTAMPTZ,
  requested_by_staff_id  BIGINT       REFERENCES payroll_staff(id) ON DELETE SET NULL,

  -- Cierre de almacen (guia final): hecho + cuando, sin persona
  guide_final_at         TIMESTAMPTZ,
  guide_final_source     TEXT         NOT NULL DEFAULT '',  -- icomfly | boxful

  raw_attribution        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  synced_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  PRIMARY KEY (store_id, icomfly_order_id)
);

CREATE INDEX IF NOT EXISTS icomfly_orders_state_idx
  ON icomfly_orders (store_id, dispatch_state);
CREATE INDEX IF NOT EXISTS icomfly_orders_requested_idx
  ON icomfly_orders (store_id, requested_at);
CREATE INDEX IF NOT EXISTS icomfly_orders_order_number_idx
  ON icomfly_orders (lower(order_number));
CREATE INDEX IF NOT EXISTS icomfly_orders_standby_idx
  ON icomfly_orders (store_id, is_standby) WHERE is_standby;
