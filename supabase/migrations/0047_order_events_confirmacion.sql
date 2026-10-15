-- Cola de confirmacion de los pedidos pendientes (lib/confirmacion.ts).
--
-- Cada intento registra el CANAL (llamada, llamada por WhatsApp, mensaje), y
-- segun el resultado:
--   - "Volver a contactar" (outcome reagendar) y "Pendiente de abono" llevan la
--     FECHA PACTADA con el cliente (no anterior a hoy);
--   - "No contesto" y "Se deja mensaje" (buzon) llevan el RECORDATORIO a 2
--     horas habiles (08:00 a 22:00 de la tienda).
-- Se calcula al registrar y se guarda: la bitacora es un registro de hechos, no
-- se reescribe.
--
-- Resultados nuevos: pendiente_abono (contacto) y ultimo_intento (decision:
-- marcar a mano que se agoto la gestion; la anulacion la hace una persona en
-- Shopify, el sistema nunca cancela solo).

ALTER TABLE order_events ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT '';
ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_canal_check;
ALTER TABLE order_events ADD CONSTRAINT order_events_canal_check
  CHECK (canal IN ('', 'llamada', 'whatsapp', 'mensaje'));

ALTER TABLE order_events ADD COLUMN IF NOT EXISTS fecha_pactada DATE;
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS recordatorio_at TIMESTAMPTZ;

ALTER TABLE order_events DROP CONSTRAINT IF EXISTS order_events_outcome_check;
ALTER TABLE order_events ADD CONSTRAINT order_events_outcome_check CHECK (outcome IN (
  '',
  'contesto','no_contesta','buzon','numero_malo',
  'confirmado','reagendar','pendiente_abono',
  'autorizar_despacho','retener','anular','ultimo_intento'
));

-- La cola lee los contactos y decisiones de la tienda de una vez.
CREATE INDEX IF NOT EXISTS order_events_store_kind_idx
  ON order_events (store_id, kind, created_at DESC);

NOTIFY pgrst, 'reload schema';
