-- ============================================================
-- Kairo AI - Telefonia Telnyx (llamadas desde el navegador con @telnyx/webrtc)
--
-- Modelo (ver lib/telnyx.ts):
--   - Cada asesora tiene una credencial de telefonia en la Credential
--     Connection de Telnyx. Kairo la crea sola la primera vez y guarda su id.
--   - Las llamadas van a la MISMA tabla que las de Zadarma (zadarma_calls), con
--     provider = 'telnyx': el historial del lead, la "ultima llamada" y la
--     productividad ya leen de ahi.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- ============================================================

ALTER TABLE payroll_staff ADD COLUMN IF NOT EXISTS telnyx_credential_id TEXT;

-- Una credencial es de UNA asesora: dos navegadores con la misma se roban
-- las llamadas entre si.
CREATE UNIQUE INDEX IF NOT EXISTS payroll_staff_telnyx_credential_idx
  ON payroll_staff (telnyx_credential_id)
  WHERE telnyx_credential_id IS NOT NULL;

-- De que telefonia es cada llamada. Las de antes son de Zadarma.
ALTER TABLE zadarma_calls ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'zadarma';

-- Cuando contesto el cliente: la duracion de la conversacion se cuenta desde
-- aqui y no desde que se marco (Telnyx no la manda hecha como Zadarma).
ALTER TABLE zadarma_calls ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;
