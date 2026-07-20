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
| `0010_multi_store_finance.sql` | Dimension `stores` y `store_id` en tablas financieras para separar Costa Rica y Honduras | Pendiente |
| `0011_forza_tracking.sql` | Cache de rastreo Forza para Honduras, separado por `store_id` y guia | Pendiente |
| `0018_icomfly_dispatch.sql` | Estado de Despacho: tablas icomfly_orders / icomfly_agents + columnas email/icomfly_user_id en payroll_staff | No |
| `0019_platform_registry.sql` | Registry multi-tienda: integraciones, couriers, perfiles de archivo, roles por tienda y tracking generico | Pendiente |
| `0020_wyn_tracking.sql` | Cache de rastreo WYN para Costa Rica, separado por `store_id` y guia `MLCR...` | Pendiente |
| `0021_finance_dataset_cache_sections.sql` | Cache L2 por secciones del dataset financiero | Pendiente |
| `0022_leads.sql` | Modulo de Leads de WhatsApp: `leads`, `lead_calls`, `lead_conversations`, `lead_webhook_events` (idempotencia), `lead_sync_state`. Identidad de vendedoras via `payroll_staff`; sin RLS (aislamiento por tienda en el API) | Si (aplicada en produccion) |

Contexto: la columna `line_items` de `shopify_orders` quedo vacia para filas
sincronizadas antes de existir — ese tipo de deriva es lo que este esquema de
migraciones busca evitar.
