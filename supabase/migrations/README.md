# Migraciones de base de datos

Reglas:

1. **Un archivo por cambio**, con prefijo numerico incremental:
   `0003_agregar_columna_x.sql`, `0004_indice_y.sql`, etc.
2. **Nunca editar un archivo ya aplicado** en produccion; los cambios van en
   una migracion nueva (los `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ...
   ADD COLUMN IF NOT EXISTS` permiten reaplicar sin romper).
3. Aplicar en orden en el editor SQL de Supabase (o con `supabase db push`
   si se adopta el CLI).

Estado actual:

| Archivo | Contenido | Aplicada en produccion |
| --- | --- | --- |
| `0001_schema.sql` | Tablas base del agente de voz (calls, retries, upsell, settings) | Si |
| `0002_finance_schema.sql` | Modulo financiero (shopify_orders, settlements, logistics, costos, gastos, claims) | Si |
| `0003_shopify_orders_note_columns.sql` | Columnas note/note_attributes + backfill line_items (fix statement timeout) | Si (14/06/2026) |
| `0004_payroll_staff.sql` | Catalogo de personal de planilla | Si (12/06/2026) |
| `0005_customer_name_parts.sql` | Columnas first_name/last_name en pedidos, logistica y liquidaciones + backfill | Si (14/06/2026) |
| `0006_moovin_tracking.sql` | Cache de estado Moovin por guia (incidencias incluidas) | Si (14/06/2026) |
| `0007_shopify_tracking.sql` | Guia/transportadora del fulfillment de Shopify (pedidos despachados sin esperar Boxful) | Si (14/06/2026) |
| `0008_product_costs_sku_unique.sql` | Indice unico en product_costs.sku (repara instancias sin el UNIQUE; el codigo ya hace upsert manual, esto es para integridad) | No (opcional) |
| `0009_product_costs_store_id_nullable.sql` | Relaja NOT NULL en product_costs.store_id (columna multi-tienda divergente que bloqueaba el guardado de costos) | Si (14/06/2026) |
| `0010_multi_store_finance.sql` | Dimension `stores` y `store_id` en tablas financieras para separar Costa Rica y Honduras | Si (en uso: la app opera multi-tienda; confirmar) |
| `0011_forza_tracking.sql` | Cache de rastreo Forza para Honduras, separado por `store_id` y guia | Si (en uso por forza-sync/tracking; confirmar) |
| `0012_finance_perf_indexes.sql` | Indices de performance para las lecturas financieras | Recomendada (solo performance) |
| `0013_finance_dataset_cache.sql` | Cache durable del dataset de pedidos del dashboard | Recomendada (si falta, el cache degrada a L1 en memoria) |
| `0015_settlement_import_idempotency.sql` | `dedup_key` + indice unico `(store_id, dedup_key)` en `settlement_rows` para que re-importar una liquidacion reemplace la fila por guia/orden (renumerada desde 0014: colisionaba con `0014_incidencias.sql` de #83) | **Pendiente — REQUIERE 0010 antes** |

> **Nota (2026-06-17):** `0010`–`0013` figuraban como "Pendiente", pero el codigo ya
> depende de ellas en produccion: el modulo financiero opera multi-tienda
> (`mireva-hn` usa `store_id=2`, **sin** fallback legacy — solo CR/`store_id=1` lo
> tiene en `shouldFallbackToLegacyStore`), forza-sync/tracking persisten en
> `forza_tracking`, y el dataset cache usa `finance_dataset_cache` (con degradacion
> a L1 si la tabla falta). En la practica `0010`/`0011` estan aplicadas; conviene
> **confirmarlo en prod**. `0015` (idempotencia de liquidaciones) es nueva y
> **depende de `0010`** (columna `store_id`). Verificacion rapida en el SQL Editor:
> `SELECT column_name FROM information_schema.columns WHERE table_name='settlement_rows' AND column_name IN ('store_id','dedup_key');`

Contexto: la columna `line_items` de `shopify_orders` quedo vacia para filas
sincronizadas antes de existir — ese tipo de deriva es lo que este esquema de
migraciones busca evitar.
