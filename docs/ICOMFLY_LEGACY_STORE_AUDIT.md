# iComfly Legacy Store Audit

Objetivo: revisar si quedaron filas de iComfly guardadas con IDs externos de
iComfly en vez de IDs internos de Kairo.

Este documento no propone borrar ni modificar datos. Es una auditoria previa
para decidir si hace falta un arreglo de datos separado, con backup y ventana
controlada.

## Contexto

Kairo usa `stores.id` como identificador interno por tienda. Hoy esperamos, por
ejemplo:

- `1`: `mireva-cr`
- `2`: `mireva-hn`

iComfly puede usar IDs externos distintos, por ejemplo `71`. Desde el
endurecimiento de iComfly, la sincronizacion debe llamar a iComfly con el ID
externo, pero persistir en Supabase el `stores.id` interno.

## Script read-only

El script `scripts/audit-icomfly-store-ids.mjs`:

- lee `stores`
- cuenta `store_id` en `icomfly_orders`
- cuenta `store_id` en `icomfly_agents`
- marca como `LEGACY_OR_UNKNOWN` cualquier `store_id` que no exista en `stores`
- no ejecuta `insert`, `update`, `delete`, `upsert` ni SQL de escritura

Uso local:

```powershell
node scripts/audit-icomfly-store-ids.mjs
```

Requiere `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`, `.env` o
variables de entorno. Si esas variables faltan o estan vacias, el script se
detiene sin tocar nada.

## SQL manual read-only

Tambien se puede revisar desde Supabase SQL Editor con consultas de solo
lectura:

```sql
select id, code, name, active
from stores
order by id;

select 'icomfly_orders' as table_name, store_id, count(*)
from icomfly_orders
group by store_id
union all
select 'icomfly_agents' as table_name, store_id, count(*)
from icomfly_agents
group by store_id
order by table_name, store_id;

select 'icomfly_orders' as table_name, store_id, count(*)
from icomfly_orders
where store_id not in (select id from stores)
group by store_id
union all
select 'icomfly_agents' as table_name, store_id, count(*)
from icomfly_agents
where store_id not in (select id from stores)
group by store_id
order by table_name, store_id;
```

## Como interpretar

Si solo aparecen IDs que existen en `stores`, no hay accion de datos pendiente.

Si aparece `store_id=71` u otro ID fuera de `stores`, tratarlo como posible dato
legacy. No borrar. El siguiente paso seria preparar un PR o runbook separado
para remapear esos registros al `stores.id` correcto, con backup confirmado y
validacion funcional despues del cambio.

## Checklist antes de cualquier arreglo

- Confirmar backup reciente de Supabase.
- Confirmar que no hay imports ni sincronizaciones fuertes en curso.
- Guardar el resultado de esta auditoria.
- Definir el mapeo exacto de ID externo a tienda interna.
- Hacer el cambio en una transaccion revisada.
- Validar `/admin/finance` en Despacho para Costa Rica y Honduras.
