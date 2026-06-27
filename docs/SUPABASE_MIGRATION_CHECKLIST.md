# Checklist de migraciones Supabase antes de mergear PR #123

Objetivo: aplicar la base multi-tienda sin romper la operacion actual de Costa
Rica. Este checklist bloquea el merge a `main` hasta que backup, migraciones y
validacion con datos reales esten completos.

## Regla de bloqueo

No mergear PR #123 hasta confirmar:

- Backup reciente y restaurable de Supabase.
- Migraciones aplicadas primero en staging, fork o entorno seguro.
- Validacion funcional de Finance e Incidencias despues de aplicar SQL.
- Costa Rica sigue mostrando los mismos datos esperados.
- No hay errores 500 en endpoints de Finance/Incidencias.

## Antes de tocar Supabase

1. Crear backup desde Supabase Dashboard.
   - Ir a Project Settings > Database > Backups.
   - Confirmar que existe un backup reciente.
   - Si el plan permite snapshot manual/PITR, crear snapshot manual antes de SQL.
2. Exportar una copia logica si se va a tocar produccion.
   - Ideal: `pg_dump` o backup descargable desde Supabase.
   - Guardar fecha, hora y responsable.
3. Confirmar que nadie esta haciendo imports de Boxful/liquidaciones o cambios
   fuertes en Finance durante la ventana de migracion.
4. Abrir el preview validado del PR y dejarlo listo para comparar.
5. No aplicar SQL si no hay forma clara de rollback.

## Preflight SQL recomendado

Ejecutar en Supabase SQL Editor antes de migrar y guardar resultados.

```sql
-- Tablas base que deben existir.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'product_costs',
    'product_cost_versions',
    'shopify_orders',
    'business_expenses',
    'settlement_imports',
    'settlement_rows',
    'logistics_imports',
    'logistics_rows',
    'finance_claims',
    'boxful_file_controls',
    'payroll_staff'
  )
order by table_name;

-- Duplicados que podrian bloquear indices unicos.
select 'product_costs.sku' as check_name, sku, count(*)
from product_costs
group by sku
having count(*) > 1;

select 'shopify_orders.shopify_order_id' as check_name, shopify_order_id, count(*)
from shopify_orders
group by shopify_order_id
having count(*) > 1;

select 'finance_claims.anomaly_key' as check_name, anomaly_key, count(*)
from finance_claims
group by anomaly_key
having count(*) > 1;

select 'boxful_file_controls.file_name/file_type' as check_name, file_name, file_type, count(*)
from boxful_file_controls
group by file_name, file_type
having count(*) > 1;

-- Si existe como indice standalone por 0008, 0010 ya lo limpia.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'product_costs'
  and indexname = 'product_costs_sku_key';
```

Si cualquier query de duplicados devuelve filas, detener la migracion y resolver
duplicados primero. No improvisar en produccion.

## Orden exacto de aplicacion

### Sobre 0008 y 0009

- `0009_product_costs_store_id_nullable.sql` ya figura como aplicado en
  produccion.
- `0008_product_costs_sku_unique.sql` figura como no aplicado/opcional. No
  aplicarlo como parte de este rollout salvo que se decida expresamente. `0010`
  reemplaza la integridad global por integridad por tienda.

Aplicar en este orden, uno por uno, validando que cada archivo termine sin error:

1. `supabase/migrations/0010_multi_store_finance.sql`
2. `supabase/migrations/0011_forza_tracking.sql`
3. `supabase/migrations/0012_finance_perf_indexes.sql`
4. `supabase/migrations/0013_finance_dataset_cache.sql`
5. `supabase/migrations/0016_incidencias.sql`
6. `supabase/migrations/0017_incident_sync_state.sql`
7. `supabase/migrations/0018_icomfly_dispatch.sql`
8. `supabase/migrations/0018_reprog_fallida.sql`
9. `supabase/migrations/0019_platform_registry.sql`

Nota: hay dos archivos con prefijo `0018`. No aplicarlos por intuicion; usar el
orden anterior.

## Migraciones delicadas

### 0010_multi_store_finance.sql

Riesgo alto. Crea `stores`, agrega `store_id` a tablas financieras, backfillea
todo lo existente a Costa Rica (`store_id = 1`), marca columnas como `NOT NULL`,
cambia constraints e indices unicos.

Validar especialmente:

- `product_costs` no tiene SKUs duplicados.
- `shopify_orders` no tiene `shopify_order_id` duplicado.
- `finance_claims` no tiene `anomaly_key` duplicado.
- `boxful_file_controls` no tiene duplicados por `file_name + file_type`.
- Despues de aplicar, todas las tablas financieras tienen `store_id`.

### 0011_forza_tracking.sql

Riesgo bajo/medio. Crea tabla nueva para Forza con primary key por
`store_id + guide_number`. No toca Costa Rica.

### 0012_finance_perf_indexes.sql

Riesgo bajo, pero depende de `0010` porque usa `store_id`. Solo crea indices de
performance.

### 0013_finance_dataset_cache.sql

Riesgo bajo. Crea tabla de cache. Si falla, el dashboard deberia caer a armado
en memoria, pero no deberia quedar pendiente antes de produccion.

### 0016_incidencias.sql

Riesgo medio. Crea tablas nuevas `incidents` e `incident_events` con FK a
`stores`. Depende de `0010`.

### 0017_incident_sync_state.sql

Riesgo bajo. Crea tabla nueva de watermark del cron.

### 0018_icomfly_dispatch.sql

Riesgo medio. Agrega columnas a `payroll_staff` y crea tablas iComfly. Revisar
si ya existen valores duplicados en `payroll_staff.icomfly_user_id` si esa
columna hubiese sido creada manualmente antes.

### 0018_reprog_fallida.sql

Riesgo medio. Cambia el check constraint de estados de incidencias. Si
`incidents` ya tuviera datos con estados fuera de la lista permitida, fallaria.

### 0019_platform_registry.sql

Riesgo bajo/medio. Agrega columnas a `stores`, crea registry de integraciones,
couriers, perfiles de archivo, roles y tracking generico. No guarda secretos,
solo nombres de variables de entorno.

## Validacion post-migracion

Ejecutar SQL:

```sql
select id, code, name, country_code, currency, active
from stores
order by id;

select 'shopify_orders' as table_name, store_id, count(*)
from shopify_orders
group by store_id
union all
select 'logistics_rows', store_id, count(*)
from logistics_rows
group by store_id
union all
select 'settlement_rows', store_id, count(*)
from settlement_rows
group by store_id
order by table_name, store_id;

select provider, count(*)
from store_integrations
group by provider
order by provider;

select courier_code, count(*)
from courier_accounts
group by courier_code
order by courier_code;
```

Validar en UI:

- `/admin/finance` carga Costa Rica.
- Selector de tienda no rompe la vista actual.
- KPIs, pedidos, productos, liquidaciones, gastos y cierre mensual cargan.
- `/admin/incidencias` carga listado, conteos, filtros y detalle.
- No hay errores 500 en consola/red.

Validar endpoints con sesion activa:

- `/api/platform/stores`
- `/api/platform/couriers?store=mireva-cr`
- `/api/finance/orders?period=all&pageSize=1&store=mireva-cr`
- `/api/finance/kpis?period=30d&store=mireva-cr`
- `/api/incidents?store=mireva-cr`

## Rollback mental

Estas migraciones son mayormente aditivas, pero `0010` cambia constraints e
indices. Si falla en medio:

1. No seguir con las siguientes migraciones.
2. Guardar el error exacto.
3. No hacer merge.
4. Restaurar backup si la base queda inconsistente.
5. Corregir en una nueva migracion, no editando una ya aplicada a produccion.

## Decision final

Solo marcar PR #123 como listo para merge cuando:

- Checklist completo.
- Preview validado despues de migraciones.
- Vercel verde.
- No hay errores funcionales en Costa Rica.
- El usuario confirma que Finance e Incidencias se ven bien con datos reales.
