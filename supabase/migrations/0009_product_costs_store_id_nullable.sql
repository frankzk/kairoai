-- La tabla product_costs en produccion tiene una columna store_id NOT NULL que
-- NO existe en las migraciones del repo: la tabla se creo con un esquema
-- multi-tienda que divergio de 0002 (esto tambien explica por que faltaba el
-- UNIQUE de sku). La app es de una sola tienda y no escribe store_id, asi que
-- el INSERT falla con:
--   null value in column "store_id" of relation "product_costs"
--   violates not-null constraint
--
-- Se relaja el NOT NULL para que los costos se puedan guardar. Es reversible y
-- no afecta lecturas (la app no filtra por store_id). Guardado con IF EXISTS por
-- si alguna instancia no tiene la columna.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_costs' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE product_costs ALTER COLUMN store_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'product_cost_versions' AND column_name = 'store_id'
  ) THEN
    ALTER TABLE product_cost_versions ALTER COLUMN store_id DROP NOT NULL;
  END IF;
END $$;
