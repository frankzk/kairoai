-- Autovacuum agresivo para las tablas financieras de alta rotacion (0023).
--
-- Contexto (incidente 2026-07-21): /admin/finance mostraba 0 pedidos y
-- "Datos operativos temporalmente no disponibles" pese a Supabase Healthy y a
-- que la metadata reconocia ~15.5k pedidos. Causa raiz: BLOAT severo por dead
-- tuples. Estas tablas se reescriben enteras muy seguido:
--   * finance_dataset_cache: el cron (cada hora) y las mutaciones hacen upsert
--     de 8 secciones x 2 tiendas con payloads de varios MB -> muchas versiones
--     muertas. Llego a 62 MB para 18 filas vivas.
--   * moovin_tracking / logistics_rows / settlement_rows: se reemplazan en bloque
--     en cada import/sync. moovin_tracking llego a 19 MB para ~10k filas; sus
--     stats decian 0 filas vivas (nunca se corrio ANALYZE) -> el planner elegia
--     seq scans sobre heaps inflados.
-- Resultado: cada lectura recorria MB de paginas muertas y superaba el timeout
-- de 20s de la lectura L2 (y el de 45s del cold build). Tras un reinicio de la
-- base (cache en frio) TODA lectura financiera caia en 503.
--
-- Correccion puntual (fuera de esta migracion, ya ejecutada en produccion):
--   VACUUM (FULL, ANALYZE) sobre finance_dataset_cache, moovin_tracking,
--   logistics_rows, settlement_rows;  ANALYZE sobre shopify_orders/icomfly/forza.
--   Reclamo el espacio y refresco los stats: las lecturas pasaron de 10-18s a
--   ~80ms y el scan de logistics_rows de 14-46s a ~33ms.
--
-- Esta migracion evita que el bloat REGRESE: baja el umbral de autovacuum/analyze
-- para que corran mucho antes (por defecto Postgres espera a que se ensucie el
-- 20% de la tabla, demasiado tarde para tablas que se reescriben enteras) y les
-- da mas presupuesto de I/O. Es idempotente (ALTER TABLE ... SET reaplica igual).

-- finance_dataset_cache: pocas filas pero cada UPDATE deja una version muerta de
-- varios MB. Vaciar tras ~2 filas sucias mantiene el TOAST chico.
ALTER TABLE finance_dataset_cache SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 2,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 2,
  autovacuum_vacuum_cost_delay = 0
);

-- Tablas de operacion que se reemplazan en bloque en cada import/sync.
ALTER TABLE moovin_tracking SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 200,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 200,
  autovacuum_vacuum_cost_delay = 0
);

ALTER TABLE logistics_rows SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 500,
  autovacuum_vacuum_cost_delay = 0
);

ALTER TABLE settlement_rows SET (
  autovacuum_enabled = true,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05,
  autovacuum_analyze_threshold = 500,
  autovacuum_vacuum_cost_delay = 0
);
