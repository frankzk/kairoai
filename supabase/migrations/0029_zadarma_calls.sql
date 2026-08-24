-- ============================================================
-- Kairo AI - Telefonia Zadarma (llamadas desde la laptop)
--
-- Modelo:
--   - Cada asesora ya existe como fila en payroll_staff (misma identidad que
--     usan leads / lead_calls / productividad). Aqui solo se le agrega su
--     extension de la centralita Zadarma (p.ej. '499499-100').
--   - zadarma_calls es el registro tecnico de la llamada (lo escribe el
--     webhook de Zadarma). NO reemplaza a lead_calls: lead_calls sigue siendo
--     la gestion comercial que registra la asesora ("no contesto", "casi
--     cierra"), esto es el CDR: quien marco, a quien, cuanto duro, grabacion.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
-- ============================================================

-- ─── Extension de centralita por asesora ────────────────────────────────────
-- Login completo de la extension tal como aparece en Zadarma (Centralita
-- virtual -> extensiones), p.ej. '499499-100'. NULL = la asesora no tiene
-- telefono asignado y el boton "Llamar" queda deshabilitado para ella.
ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS zadarma_sip TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payroll_staff_zadarma_sip_idx
  ON payroll_staff (zadarma_sip)
  WHERE zadarma_sip IS NOT NULL;

-- La asignacion se hace desde la app: /admin/finance -> catalogo de personal
-- ofrece las extensiones reales de la centralita (/v1/pbx/internal/). El indice
-- unico de arriba impide que dos personas compartan extension: dos navegadores
-- registrados en la misma linea se roban las llamadas entre si.

-- ─── zadarma_calls: CDR de la centralita ────────────────────────────────────
CREATE TABLE IF NOT EXISTS zadarma_calls (
  id                BIGSERIAL     PRIMARY KEY,

  -- Identidad de la llamada en Zadarma. pbx_call_id es estable durante toda
  -- la llamada (sobrevive transferencias y menus), por eso es la clave.
  pbx_call_id       TEXT          NOT NULL,
  call_id_with_rec  TEXT,                            -- id para descargar grabacion

  store_id          BIGINT        REFERENCES stores(id) ON DELETE SET NULL,
  lead_id           BIGINT        REFERENCES leads(id) ON DELETE SET NULL,
  vendedora         BIGINT        REFERENCES payroll_staff(id) ON DELETE SET NULL,

  direction         TEXT          NOT NULL DEFAULT 'outgoing',  -- outgoing | incoming
  internal          TEXT,                            -- extension que hablo
  phone             TEXT,                            -- cliente, E.164 sin '+'
  raw_phone         TEXT,                            -- como lo mando Zadarma

  status            TEXT,                            -- disposition de Zadarma
                                  -- answered | busy | cancel | no answer | failed | ...
  duration_seconds  INTEGER       NOT NULL DEFAULT 0,
  is_recorded       BOOLEAN       NOT NULL DEFAULT FALSE,
  record_url        TEXT,

  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (pbx_call_id)
);

CREATE INDEX IF NOT EXISTS zadarma_calls_lead_idx      ON zadarma_calls (lead_id, started_at DESC);
CREATE INDEX IF NOT EXISTS zadarma_calls_store_idx     ON zadarma_calls (store_id, started_at DESC);
CREATE INDEX IF NOT EXISTS zadarma_calls_vendedora_idx ON zadarma_calls (vendedora, started_at DESC);
CREATE INDEX IF NOT EXISTS zadarma_calls_phone_idx     ON zadarma_calls (phone, started_at DESC);

CREATE OR REPLACE FUNCTION zadarma_calls_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS zadarma_calls_touch ON zadarma_calls;
CREATE TRIGGER zadarma_calls_touch BEFORE UPDATE ON zadarma_calls
  FOR EACH ROW EXECUTE FUNCTION zadarma_calls_touch_updated_at();
