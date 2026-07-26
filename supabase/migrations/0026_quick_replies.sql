-- ============================================================
-- Kairo AI - Leads: respuestas rapidas del chat.
--
-- Plantillas de texto que la asesora inserta con un click (o con el atajo "/")
-- en el composer del drawer, para no reescribir siempre lo mismo: precio,
-- envio, garantia, "es original", etc.
--
-- Reglas:
--   - Una fila por tienda (store_id): CR y HN tienen precios y couriers
--     distintos, asi que no se comparten.
--   - `body` admite variables que se interpolan al insertar:
--       {nombre}  -> nombre del lead (o "" si no hay)
--       {tienda}  -> nombre corto de la tienda
--     Se resuelven en el cliente al momento de insertar, no al guardar, para
--     que la plantilla siga siendo generica.
--   - `usage_count` sube cada vez que se usa: las mas usadas se muestran
--     primero como chips en el composer (aprendizaje sin configuracion).
--   - Borrado logico via `active` para no perder el historial de uso.
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_replies (
  id            BIGSERIAL     PRIMARY KEY,
  store_id      BIGINT        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  -- Etiqueta corta que se ve en el chip / buscador (ej. "Precio").
  title         TEXT          NOT NULL,
  -- Texto que se inserta en el composer (admite {nombre} / {tienda}).
  body          TEXT          NOT NULL,
  usage_count   INTEGER       NOT NULL DEFAULT 0,
  active        BOOLEAN       NOT NULL DEFAULT TRUE,
  -- Asesora que la creo (informativo; las respuestas son de toda la tienda).
  created_by    BIGINT        REFERENCES payroll_staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Listado del composer: activas de la tienda, mas usadas primero.
CREATE INDEX IF NOT EXISTS quick_replies_store_idx
  ON quick_replies (store_id, active, usage_count DESC);

-- Evita duplicar la misma etiqueta dentro de una tienda.
CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_store_title_idx
  ON quick_replies (store_id, lower(title))
  WHERE active;
