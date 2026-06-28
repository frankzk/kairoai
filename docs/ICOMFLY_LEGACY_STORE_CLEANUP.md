# iComfly Legacy Store Cleanup

Objetivo: limpiar de forma conservadora filas de iComfly que quedaron guardadas
con el ID externo de iComfly (`71`) en `icomfly_orders.store_id`.

Este cambio no se debe aplicar como migracion automatica. Es un runbook manual
para Supabase SQL Editor, con backup confirmado y validacion posterior.

## Contexto

La arquitectura correcta separa dos IDs:

- `stores.id = 1`: tienda interna Kairo para `mireva-cr`.
- `71`: ID externo de cuenta/tienda en iComfly para llamar su API.

El `71` no debe vivir como `store_id` operativo dentro de Kairo. Debe vivir en
env/config como credencial o parametro externo.

## Resultado de auditoria

Auditoria ejecutada despues de PR #127:

- `icomfly_orders.store_id = 1`: 516 filas.
- `icomfly_orders.store_id = 71`: 1404 filas legacy.
- Filas `71` que ya existen tambien en `1`: 497.
- Filas `71` que no existen en `1`: 907.
- `icomfly_agents`: sin filas.

Los conteos pueden cambiar si corre una nueva sincronizacion antes de aplicar la
limpieza. Por eso el SQL vuelve a calcular todo en vivo antes de tocar datos.

## Regla de limpieza

Mover solamente filas legacy que no chocan con la llave actual:

```sql
legacy.store_id = 71
and not exists (
  select 1
  from icomfly_orders target
  where target.store_id = 1
    and target.icomfly_order_id = legacy.icomfly_order_id
)
```

No borrar duplicados. Los duplicados `71` que ya existen en `1` quedan intactos
hasta una decision separada, porque `store_id=1` contiene la sincronizacion
actual y mas reciente.

## SQL

Archivo manual:

```text
supabase/manual/icomfly_legacy_store_cleanup.sql
```

El archivo tiene dos partes:

1. Preflight read-only.
2. Transaccion de movimiento con `ROLLBACK` por defecto.

Para aplicar realmente, primero ejecutar y revisar con `ROLLBACK`. Si los
conteos son correctos, cambiar solo la ultima linea de la transaccion de
`rollback;` a `commit;` y volver a ejecutar esa transaccion.

## Checklist antes de aplicar

- Confirmar backup reciente de Supabase.
- Confirmar que no hay sincronizacion iComfly corriendo al mismo tiempo.
- Confirmar que nadie esta revisando Despacho como operacion critica en ese
  minuto.
- Ejecutar el preflight read-only.
- Confirmar que los candidatos a mover no tienen duplicado en `store_id=1`.
- Ejecutar la transaccion primero con `ROLLBACK`.
- Aplicar con `COMMIT` solo si el conteo de `moved_rows` es el esperado.

## Validacion posterior

Ejecutar:

```sql
select store_id, count(*)
from icomfly_orders
group by store_id
order by store_id;

select count(*) as remaining_legacy_not_duplicated
from icomfly_orders legacy
where legacy.store_id = 71
  and not exists (
    select 1
    from icomfly_orders target
    where target.store_id = 1
      and target.icomfly_order_id = legacy.icomfly_order_id
  );
```

El segundo query debe regresar `0` despues del cleanup. Aun pueden quedar filas
con `store_id=71` si son duplicados historicos ya presentes en `store_id=1`.

Luego validar UI:

- `/admin/finance`, tienda Mireva Costa Rica.
- Tab `Despacho`.
- Conteos de iComfly cargan sin `store requerido`.
- No aparecen errores 500 en network.
