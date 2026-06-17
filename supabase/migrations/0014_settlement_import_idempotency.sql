-- ============================================================
-- Kairo AI - Idempotencia del import de liquidaciones
-- Requiere 0010_multi_store_finance.sql (columna store_id en settlement_rows).
-- Ejecutar en el editor SQL de Supabase.
-- ============================================================
--
-- Objetivo: que re-importar una liquidacion corregida REEMPLACE la fila previa
-- de esa guia ("la ultima version gana") en vez de duplicarla. La app calcula la
-- misma `dedup_key` al importar y hace upsert por (store_id, dedup_key).
--
-- Solo aplica a settlement_rows (liquidaciones). logistics_rows NO se toca: ahi
-- la multiplicidad por guia es esperada (imports de periodos solapados) y la
-- consolidacion en lectura ya elige el estado final; la idempotencia de
-- logistica es a nivel archivo (en el codigo, re-subir el mismo archivo lo
-- reemplaza), sin indice unico por guia.

-- Clave de deduplicacion por fila: guia (preferida) u orden.
ALTER TABLE settlement_rows ADD COLUMN IF NOT EXISTS dedup_key TEXT NOT NULL DEFAULT '';

-- Backfill de filas existentes. Las que no tienen ni guia ni orden reciben una
-- clave unica basada en su id (no se deduplican: no tienen clave natural).
UPDATE settlement_rows
   SET dedup_key = COALESCE(NULLIF(BTRIM(guide_number), ''), NULLIF(BTRIM(order_name), ''), 'id:' || id::text)
 WHERE dedup_key = '';

-- Indice unico que habilita el upsert por (store_id, dedup_key). Al momento de
-- esta migracion settlement_rows no tiene duplicados por (guia/orden)
-- (verificado), por lo que la creacion del indice no falla.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_rows_store_dedup_key_idx
  ON settlement_rows (store_id, dedup_key);

NOTIFY pgrst, 'reload schema';
