-- product_costs.sku debe ser UNICO para garantizar un costo por sku. En la
-- definicion original (0002) la columna se declaro UNIQUE, pero si la tabla ya
-- existia, CREATE TABLE IF NOT EXISTS no agrego la restriccion: la instancia
-- quedo sin indice unico y el upsert con ON CONFLICT (sku) fallaba con
-- "there is no unique or exclusion constraint matching the ON CONFLICT".
--
-- El codigo ya hace upsert manual (buscar-y-actualizar) y no depende de esto,
-- pero el indice unico protege la integridad de los datos.

-- 1) Normaliza el sku a minusculas y sin espacios, como lo guarda la app.
UPDATE product_costs SET sku = lower(btrim(sku)) WHERE sku <> lower(btrim(sku));

-- 2) Elimina duplicados de sku conservando la fila mas reciente (id mayor).
DELETE FROM product_costs a
USING product_costs b
WHERE a.sku = b.sku AND a.id < b.id;

-- 3) Indice unico que respalda la integridad y el upsert por sku.
CREATE UNIQUE INDEX IF NOT EXISTS product_costs_sku_key ON product_costs (sku);
