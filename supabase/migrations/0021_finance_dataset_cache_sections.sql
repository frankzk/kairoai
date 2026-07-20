-- Cache L2 del dataset de finanzas por SECCION (0021).
--
-- Contexto: 0013 guardaba el dataset completo en una sola fila por tienda
-- (section='full'). Con ~15k pedidos el payload llego a ~8MB gzip y cada ruta
-- lo descargaba entero aunque solo usara una parte (orders/ usa rows+traces,
-- ~1.6MB). Esta migracion permite una fila por (store_id, section) para que
-- cada ruta lea solo sus secciones.
--
-- Compatibilidad: las filas viejas quedan con section='full' y el codigo las
-- usa como fallback si las filas por seccion aun no existen (o si esta
-- migracion no se aplico todavia). Aplicar en cualquier orden respecto al
-- deploy del codigo: sin la migracion, el codigo sigue leyendo/escribiendo la
-- fila 'full' igual que antes.

ALTER TABLE finance_dataset_cache
  ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'full';

-- La PK pasa de (store_id) a (store_id, section). La fila vieja
-- (store_id, 'full') queda valida bajo la nueva PK.
ALTER TABLE finance_dataset_cache DROP CONSTRAINT IF EXISTS finance_dataset_cache_pkey;
ALTER TABLE finance_dataset_cache ADD PRIMARY KEY (store_id, section);

NOTIFY pgrst, 'reload schema';
