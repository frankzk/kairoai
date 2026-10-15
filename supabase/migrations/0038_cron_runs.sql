-- Salud de los procesos automaticos: una fila por cron, que se sobreescribe en
-- cada corrida. Sin historial a proposito: la pregunta que contesta es "esta
-- al dia, si o no", y para eso alcanza con la ultima corrida. No crece.
--
-- Por que: cuando un cron dejaba de funcionar nadie se enteraba. Los tres
-- cortes de septiembre los encontro el dueño mirando una pantalla rota; el
-- cron leads-inbound lleva apagado desde el 29/08 sin que nada lo dijera.
--
-- `last_started_at` se escribe ANTES de trabajar y `last_finished_at` despues:
-- si Vercel mata la funcion por timeout, el final nunca se escribe, y
-- "empezo pero no termino" es como se ve un timeout desde adentro.
--
-- `registered_at` lo pone la PRIMERA corrida de cada proceso y no se vuelve a
-- tocar. Sirve de referencia para uno que todavia no termino bien nunca.
--
-- NO se siembra a proposito. Sembrar con la hora de esta migracion haria que,
-- si el deploy llega horas despues, la tira se prenda en falso el primer dia
-- (hasta 12 h acusando a un proceso que corre dos veces por dia). En cambio,
-- un proceso que nunca escribio fila se mide contra la primera fila de
-- CUALQUIER proceso —la de `leads`, a los 5 minutos del deploy—: asi uno que
-- nunca llega a correr (como paso con shopify-recent, cortado por el
-- middleware con 401) igual aparece, pero solo despues de su plazo.

CREATE TABLE IF NOT EXISTS cron_runs (
  name              TEXT          PRIMARY KEY,
  registered_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_started_at   TIMESTAMPTZ,
  last_finished_at  TIMESTAMPTZ,
  last_ok_at        TIMESTAMPTZ,
  last_status       INTEGER,
  last_duration_ms  INTEGER,
  last_error        TEXT,
  last_error_at     TIMESTAMPTZ,
  -- Lo que devolvio el cron (contadores como skipped_no_phone), recortado a
  -- 4 KB. Para diagnosticar, no para mostrar.
  last_summary      JSONB
);

-- Solo la usa el servidor con service role, que no pasa por RLS. Activarla sin
-- politicas deja la tabla cerrada para cualquier otra clave.
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
