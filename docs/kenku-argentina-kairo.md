# Kenku Argentina en Kairo

Implementación del 26 de octubre de 2026.

## Conexión comprobada

Proyecto Vercel `kairoai`, equipo `team_xuuGPoRqgPy9HHI9lYRRcwVE`.
Las cuatro variables sensibles `SHOPIFY_KENKU_AR_SHOP_DOMAIN`,
`SHOPIFY_KENKU_AR_ACCESS_TOKEN`, `SHOPIFY_KENKU_AR_CLIENT_ID` y
`SHOPIFY_KENKU_AR_CLIENT_SECRET` ya estaban en Production. Se consultaron
metadatos, sin descifrar ni sustituir secretos.

El respaldo existente había leído 662 pedidos en ARS, 16 productos y 8.491
clientes. Su estado de pedidos estaba completo, actualizado y sin error al
verificarlo. Esto acredita la lectura disponible para esa app; no se certifica
que contenga todo el histórico de Shopify. La fecha de creación más antigua
del respaldo observado era el 26 de agosto de 2026.

## Gestión

Entrada: `/admin/finance/argentina`, también en la barra de navegación y el
selector compartido con Italia. Acceso: tienda `kenku-ar` y permiso `pedidos`
o `finanzas`; el administrador legado conserva su acceso. La administración
de usuarios permite asignar Argentina sin agregarla a los couriers de CR/HN.

Se reutilizan los componentes de pedidos de Italia con configuración explícita:
ARS, formato es-AR, America/Argentina/Buenos_Aires y CP alfanumérico. El offset
original de Shopify se conserva en base; los días se filtran en horario
argentino. El shop observado estaba configurado en America/Lima: no se cambió
esa configuración ni se reinterpretaron sus timestamps como horas sin offset.

Tabla de 50 pedidos, búsqueda, fechas, contadores, dirección/productos, notas,
courier/guía manual e historial de gestión. Las transiciones locales mantienen
versión e idempotencia. Los estados originales de pago y preparación se ven
por separado. Un pago no confirma entrega ni una liquidación bancaria.

API: `GET /api/argentina/orders`,
`GET/POST /api/argentina/shopify/[id]`. La tienda y el actor se resuelven en el
servidor. Los POST requieren Origin propio y revisión del registro/fuente.
No escriben en Shopify ni crean pedidos WooCommerce.

## Base y actualización

Migración `20261026201147_kenku_argentina_management.sql`, aplicada y registrada
en `xxqunqnicvjhnwbnyghe`. Activa únicamente la tienda Argentina. Tablas
argentina_shopify_management, argentina_shopify_events y argentina_shopify_index;
vista argentina_orders con security_invoker. Todas privadas, RLS activada y
acceso de tablas/funciones reservado a service_role. La función de clasificación
nativa ya probada de Italia se comparte sin modificarla.

Un trigger refresca el índice cuando cambia el respaldo. Continúa el cron
Shopify existente cada cinco minutos. No se agregan tareas ni credenciales.
La entrada en TIENDAS_SOLO_RESPALDO se conserva como catálogo de credenciales
de lectura para no alterar la autorización Shopify existente.

## Verificación

1.362 pruebas automatizadas correctas, tipos/lint/build correctos. El SQL de
`tests/argentina-management-database.sql` prueba con BEGIN/ROLLBACK permisos,
RLS, aislamiento, transiciones, notas, idempotencia, revisiones, conservación
del respaldo y refresco del índice. La prueba inicial incluyó crear el esquema
completo y revertirlo antes de aplicar la migración definitiva.

QA de navegador: lectura real paginada; pruebas de gestión simuladas para no
alterar pedidos. Se comprueban ARS, fecha local, CP, búsqueda, paginación,
conflicto de guardado, móvil e integración italiana existente.

## Pendiente de fuente argentina

El dueño identificó DropLatam y Fixy, y pospuso revisar sus accesos. El portal
Fixy encontrado públicamente no es el que utiliza; no se presume acceso a ese
sistema. Deben confirmarse los paneles/API o archivos reales. No se conecta
Elogy Italia a Argentina ni se inventan entregas, cobros, tarifas, costos de
producto, gastos o abonos bancarios. Logística automática, liquidaciones,
rentabilidad y conciliación quedan pendientes de esos datos. Tampoco se ha
solicitado ni configurado una tienda WooCommerce argentina.

