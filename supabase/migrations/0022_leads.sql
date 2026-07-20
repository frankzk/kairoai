-- ============================================================
-- Kairo AI - Modulo de Leads de WhatsApp (Icomfly, Costa Rica)
-- Fase 1: seguimiento y clasificacion de conversaciones que NO
-- terminaron en orden. Portado desde docs/leads-spec/ y adaptado
-- a este repo:
--   - store_id es BIGINT (no uuid) y referencia stores(id).
--   - La identidad de vendedoras usa payroll_staff (no auth.users);
--     no hay Supabase Auth todavia, el aislamiento por tienda se
--     impone en la frontera del API con service role (patron del repo).
--   - Sin RLS por ahora (nada en el repo lo usa); documentado.
-- Idempotente: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ============================================================

-- ─── leads: entidad central (un telefono = un lead por tienda) ───────────────
CREATE TABLE IF NOT EXISTS leads (
  id                    BIGSERIAL     PRIMARY KEY,
  store_id              BIGINT        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Identidad (dedup por telefono dentro de la tienda)
  phone                 TEXT          NOT NULL,          -- E.164 sin '+' (CR: 506########)
  wa_id                 TEXT,
  name                  TEXT,

  -- Relacion con Icomfly
  crm_conversation_id   TEXT,                            -- id de conversacion en Icomfly
  crm_contact_id        TEXT,
  wa_phone_number_id    TEXT,                            -- numero de WhatsApp (multi-numero)

  -- Ciclo de vida / clasificacion
  category              TEXT          NOT NULL DEFAULT 'open',   -- won | hot | open | lost
  status                TEXT          NOT NULL DEFAULT 'nuevo',  -- ver lib/leads-classify.ts
  status_source         TEXT          NOT NULL DEFAULT 'auto',   -- auto | manual
  auto_reason           TEXT,                            -- por que la ingesta lo clasifico asi
  needs_attention       BOOLEAN       NOT NULL DEFAULT FALSE,
  attention_waves       INT           NOT NULL DEFAULT 0,

  -- Enlace con ordenes (Shopify)
  shopify_order_name    TEXT,
  has_order             BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Asignacion / gestion (identidad = payroll_staff)
  claimed_by            BIGINT        REFERENCES payroll_staff(id) ON DELETE SET NULL,
  claimed_at            TIMESTAMPTZ,                     -- lock "Tomar lead", TTL 10 min
  closed_by             BIGINT        REFERENCES payroll_staff(id) ON DELETE SET NULL,
  next_followup_at      TIMESTAMPTZ,

  -- Reloj de interaccion
  first_seen_at         TIMESTAMPTZ,
  last_interaction_at   TIMESTAMPTZ,                     -- cualquier direccion
  last_inbound_at       TIMESTAMPTZ,                     -- solo cliente->negocio (ventana 24h)
  last_reopen_at        TIMESTAMPTZ,

  -- Senales de clasificacion (informativas; no cambian status por si solas)
  last_message_text     TEXT,
  last_message_sender   TEXT,
  unread_count          INT           NOT NULL DEFAULT 0,
  chatbot_disabled      BOOLEAN       NOT NULL DEFAULT FALSE,
  district              TEXT,
  cart_value            NUMERIC(14,2),
  cart_item_count       INTEGER,
  cart_summary          TEXT,
  has_cart_signal       BOOLEAN       NOT NULL DEFAULT FALSE,
  inbound_count         INTEGER       NOT NULL DEFAULT 0,
  labels                TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Pago adelantado (Costa Rica: SINPE Movil)
  payment_offered_to    BIGINT        REFERENCES payroll_staff(id) ON DELETE SET NULL,
  payment_offered_at    TIMESTAMPTZ,
  payment_passed        BIGINT[]      NOT NULL DEFAULT ARRAY[]::BIGINT[],
  payment_alert_sent_at TIMESTAMPTZ,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, phone)
);

CREATE INDEX IF NOT EXISTS leads_store_last_interaction_idx ON leads (store_id, last_interaction_at DESC);
CREATE INDEX IF NOT EXISTS leads_store_category_idx         ON leads (store_id, category);
CREATE INDEX IF NOT EXISTS leads_store_status_idx           ON leads (store_id, status);
CREATE INDEX IF NOT EXISTS leads_store_followup_idx         ON leads (store_id, next_followup_at);
CREATE INDEX IF NOT EXISTS leads_store_attention_idx        ON leads (store_id, needs_attention);
CREATE INDEX IF NOT EXISTS leads_store_conversation_idx     ON leads (store_id, crm_conversation_id);

-- Trigger touch de updated_at (reutiliza la funcion si ya existe en el esquema)
CREATE OR REPLACE FUNCTION leads_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS leads_touch ON leads;
CREATE TRIGGER leads_touch BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_touch_updated_at();

-- ─── lead_calls: historial de gestiones (auditoria + productividad) ──────────
CREATE TABLE IF NOT EXISTS lead_calls (
  id                BIGSERIAL     PRIMARY KEY,
  lead_id           BIGINT        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  store_id          BIGINT        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  vendedora         BIGINT        REFERENCES payroll_staff(id) ON DELETE SET NULL,
  kind              TEXT          NOT NULL DEFAULT 'call',
                                  -- call | state_change | note | sale | system
  new_status        TEXT,
  note              TEXT,
  next_followup_at  TIMESTAMPTZ,
  occurred_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_calls_lead_idx      ON lead_calls (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS lead_calls_store_idx     ON lead_calls (store_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS lead_calls_vendedora_idx ON lead_calls (vendedora, occurred_at DESC);

-- ─── lead_conversations: espejo ligero de la conversacion de Icomfly ─────────
-- No persiste mensajes; el transcript se lee en vivo al abrir el drawer.
CREATE TABLE IF NOT EXISTS lead_conversations (
  id                    BIGSERIAL     PRIMARY KEY,
  store_id              BIGINT        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  crm_conversation_id   TEXT          NOT NULL,
  phone                 TEXT,
  platform              TEXT,
  status                TEXT,
  last_message_at       TIMESTAMPTZ,
  message_count         INTEGER,
  inbound_count         INTEGER,
  raw                   JSONB         NOT NULL DEFAULT '{}'::jsonb,
  synced_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, crm_conversation_id)
);
CREATE INDEX IF NOT EXISTS lead_conversations_store_idx ON lead_conversations (store_id, last_message_at DESC);

-- ─── lead_webhook_events: idempotencia de webhooks (no-negociable dia 1) ─────
-- Listo desde Fase 1 aunque el primer webhook llegue en Fase 3.
CREATE TABLE IF NOT EXISTS lead_webhook_events (
  id           BIGSERIAL     PRIMARY KEY,
  store_id     BIGINT        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  topic        TEXT          NOT NULL DEFAULT '',
  webhook_id   TEXT          NOT NULL,
  error        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, webhook_id)
);

-- ─── lead_sync_state: cursores/watermark del cron de ingesta por tienda ──────
CREATE TABLE IF NOT EXISTS lead_sync_state (
  source_key   TEXT          PRIMARY KEY,   -- p.ej. "icomfly_chat:1"
  cursor       TEXT,
  watermark    TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

NOTIFY pgrst, 'reload schema';
