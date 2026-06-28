# Store-Aware API Audit

Objetivo: que las APIs operativas que leen o escriben datos por tienda exijan
`store` de forma explicita. Este documento cubre el endurecimiento sin SQL y sin
cambios visuales.

## Regla

- APIs por tienda deben usar `getRequiredStoreFromSearchParams` o
  `getRequiredStoreFromBody`.
- Si falta `store`, deben responder `400` con un mensaje claro.
- Los helpers con default temporal (`getStoreFromSearchParams` /
  `getStoreFromBody`) no deben usarse dentro de `app/api`.

## Endpoints Endurecidos

- Finance: ordenes, KPIs, resumen, costos, gastos, liquidaciones, reclamos,
  notas, producto, rematch, Boxful, Forza.
- Incidencias: listado, detalle, escritura y acciones.
- Shopify operativo: ordenes, productos, checkouts, notas y draft orders.
- Platform couriers.
- iComfly manual sync: `GET/POST /api/icomfly/sync`.

## Excepciones Intencionales

- Crons que recorren tiendas: `cron/finance-index`, `cron/shopify-refresh`,
  `cron/moovin`, `cron/icomfly`.
- Moovin tracking cache: Moovin se guarda como cache global por paquete y luego
  refresca las tiendas que usan Moovin.
- Payroll staff: planilla operativa compartida por ahora.
- Shopify OAuth callback: resuelve tienda desde el `state` del flujo OAuth.
- Endpoints legacy/globales fuera de Finance multi-tienda: auth, Retell, dashboard
  antiguo, settings, upsell rules y exchange-rate.

## Guardrail

`tests/store-aware-routes.test.ts` falla si una ruta en `app/api` vuelve a usar
los helpers suaves con default de tienda. La intencion es que nuevas APIs por
tienda nazcan obligando `store`, y que cualquier excepcion sea explicita.
