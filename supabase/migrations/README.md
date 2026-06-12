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
| `0003_shopify_orders_note_columns.sql` | Columnas note/note_attributes + backfill line_items (fix statement timeout) | Pendiente de confirmar |
| `0004_payroll_staff.sql` | Catalogo de personal de planilla | Si (12/06/2026) |

Contexto: la columna `line_items` de `shopify_orders` quedo vacia para filas
sincronizadas antes de existir — ese tipo de deriva es lo que este esquema de
migraciones busca evitar.
