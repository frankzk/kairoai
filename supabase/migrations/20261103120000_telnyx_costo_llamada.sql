-- Costo de cada llamada de Telnyx (03/11/2026).
--
-- Telnyx lo manda al terminar la llamada en el evento call.cost, si la
-- Credential Connection tiene call_cost_in_webhooks activado (se activa desde
-- Configuracion > Telefonia Telnyx). Las llamadas de Zadarma quedan en NULL.
--
-- telnyx_call_control_id: el id de la llamada en Telnyx, guardado al marcar.
-- Sirve para encontrar la llamada si call.cost llegara sin client_state.

ALTER TABLE zadarma_calls
  ADD COLUMN IF NOT EXISTS cost NUMERIC(12, 5),
  ADD COLUMN IF NOT EXISTS cost_currency TEXT,
  ADD COLUMN IF NOT EXISTS billed_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS telnyx_call_control_id TEXT;

CREATE INDEX IF NOT EXISTS zadarma_calls_telnyx_call_control_id_idx
  ON zadarma_calls (telnyx_call_control_id)
  WHERE telnyx_call_control_id IS NOT NULL;
