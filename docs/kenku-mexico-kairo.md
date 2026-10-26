# Kenku México en Kairo

26-10-2026. Solicitud del dueño: replicar la operación de Italia para México.

## Gestión disponible

`/admin/finance/mexico` usa la tabla compacta de Italia con sus filtros por
fecha y estado, búsqueda por pedido/cliente/teléfono, paginación de 50 pedidos,
dirección y CP, productos/SKU, pago y envío original, guía, gestión e historial.
La moneda es MXN y los periodos siguen `America/Mexico_City`, confirmado por
el recurso shop del respaldo. La presentación compartida conserva el flujo
WooCommerce y la navegación financiera de Italia.

México se agrega al catálogo de permisos y al selector de Gestión, sin añadirlo
a los crons financieros y couriers de Costa Rica y Honduras. Una cuenta que solo
tiene México llega a su Gestión. Cada ruta valida identidad, permiso de pedidos
o finanzas y tienda asignada. Los cambios exigen Origin propio, versión, fecha de
actualización del origen y UUID. Estado, nota interna, courier y guía se guardan
en Kairo con auditoría; no modifican el pedido en Shopify.

## Conexión verificada

Vercel `frvnkzzz-1979s-projects/kairoai`, proyecto
`prj_DaPovATFijmdMMffHkXQa8KImbh1`, contiene en Production las cuatro variables
`SHOPIFY_KENKU_MX_{SHOP_DOMAIN,ACCESS_TOKEN,CLIENT_ID,CLIENT_SECRET}`.
Solo se leyeron metadatos de esos secretos. El cron existente leyó México sin
error y mantiene el respaldo actualizado. Se verificaron 24.120 pedidos
persistidos, todos MXN, además de clientes, productos y otros recursos.
No se hace una segunda importación ni se crean pedidos nuevos para el histórico.

La migración `20261026201006_kenku_mexico_shopify_management.sql` está aplicada
en `kairo-ai` (`xxqunqnicvjhnwbnyghe`). Activa `kenku-mx` (id 3) y crea
`mexico_shopify_management`, `mexico_shopify_events`, `mexico_shopify_index`
y la vista `mexico_orders`. El índice se actualiza desde el respaldo y evita
descomprimir todos los payloads al contar. Tablas con RLS, vista SECURITY
INVOKER, funciones SECURITY INVOKER con search_path vacío, acceso exclusivo
service_role y privilegios de clientes revocados.

## DropLatam y alcance pendiente

El dueño indicó que parte de los envíos está en DropLatam México:
https://mx.droplatam.com.br/auth/login. Shopify confirma fulfillments con
servicios `fulfillment-dropi` y `manual`. Las guías ya presentes en Shopify se
muestran, pero esto no acredita una conexión directa con DropLatam.

Vercel no tiene variables identificables de DropLatam/Dropi. La herramienta de
uso de Chrome detuvo la inspección porque no pudo verificar la URL; no se obtuvo
sesión autenticada ni contrato API. Para continuar hace falta acceso verificable
a la cuenta o exportaciones de envíos, cargos y liquidaciones. También queda por
identificar el resto de operadores, pues DropLatam solo cubre parte de los envíos.

Los estados del histórico son los que permite inferir Shopify. Fulfilled se
muestra como enviado y solo una evidencia explícita de entrega permite inferir
entregado. Pago recibido no implica entrega. Los ceros en entregados/devueltos
no acreditan la ausencia de esas operaciones en DropLatam. La interfaz explica
que sus entregas y liquidaciones aún no están conciliadas.

No se presenta rentabilidad ni saldo bancario de México sin cargos, remesas,
abonos y costos de producto comprobados. No hay conexión WooCommerce mexicana
en la configuración inspeccionada; esta entrega opera Shopify en Kairo.

## Verificación

1.354 pruebas, TypeScript, lint y build correctos. Pruebas SQL con BEGIN/ROLLBACK
comprueban transiciones, idempotencia, conflicto de versiones, refresco del
índice, precedencia de cancelación y reembolso nativos, aislamiento y
preservación del respaldo. Los fixtures sintéticos no permanecen en la base.

QA local con lectura real: API autenticada, 50 filas, contadores exactos de
24.120 pedidos, paginación, búsqueda, estados, detalle con CP, formulario de
gestión simulado sin escrituras, escritorio y móvil sin desbordamiento,
navegación México/Italia y ausencia de errores del navegador. Evidencias en
`output/playwright/kenkumx` de la carpeta local original del usuario.

Publicación y verificación final de producción se registran al cierre.
