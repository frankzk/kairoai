-- Reconciliacion automatica de novedades con el tracking del courier:
--   entregada -> resuelta · devuelta -> perdida · reprogramada que fallo ->
--   reprog_fallida (estado nuevo, no terminal).
--
-- 1) Estado nuevo 'reprog_fallida': se reprogramo pero vencio la fecha sin
--    entrega, o el courier volvio a fallar despues de reprogramar.
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_status_check
  CHECK (status IN (
    'pendiente','reprogramada','reprog_fallida','sin_contestar','no_llamar',
    'resuelta','perdida','descartada'));

-- 2) Momento de la ultima reprogramacion. Permite distinguir una falla NUEVA
--    (posterior a reprogramar) de la misma falla que origino la reprogramacion.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reprogramada_at TIMESTAMPTZ;
