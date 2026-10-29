# Marketing de Mireva Costa Rica

## Bosquejo confirmado, 2026-10-29

El PDF de referencia propone una vista ejecutiva de ventas, CPA e inversión, resultados por producto, inventario, campañas por cuenta, tendencias y alertas. Se mantienen las cinco cuentas Meta, incluida CR3 aunque no figure en la segunda página del bosquejo.

Decisiones confirmadas por el dueño:

- La métrica principal de ventas es pedidos creados y el CPA principal usa pedidos creados como denominador. Entregas, confirmaciones y cobro se muestran aparte.
- Cada campaña anuncia un solo producto. Falta validar cómo se identifica y persiste la relación campaña-producto.
- Umbrales globales: alerta de CPA superior a US$8.50 y stock disponible menor a 100 unidades.
- Los filtros solicitados incluyen hoy, ayer, últimos 7/14/28/30 días, mes pasado y calendario; tablas ordenables y filtros de producto.

Pendiente de definición: reconocimiento de producto en nombres de campañas o asignación editable, registro del origen orgánico/upsell y significado diario o total de la columna presupuesto. Las ventas sin evidencia de origen se mantienen sin atribuir; no se infiere que sean orgánicas por diferencia entre reportes publicitarios y pedidos. Las oportunidades de escala y alertas de inventario requieren stock real y un mínimo de evidencia antes de presentarse como recomendaciones.

Primera tienda: `mireva-cr`. Panel integrado en `/admin/marketing`, accesible con el permiso `finanzas` y el acceso a Costa Rica. El acceso aparece en la barra de Kairo para esas personas. API: `GET /api/marketing/summary?store=mireva-cr&month=YYYY-MM`.

## Datos disponibles

El panel reutiliza el dataset conciliado de Gestión y sus reglas para unir Icomfly, histórico de Shopify, logística y liquidaciones. No crea pedidos a partir de reportes de publicidad o stock. La API devuelve agregados y productos, sin nombres de clientes, teléfonos ni identificadores de pedidos.

El mes corresponde a la fecha de creación del pedido en `America/Costa_Rica`, con límites inclusivo/exclusivo a medianoche de Costa Rica. Los estados corresponden al último dato operativo disponible, no al día de cierre histórico de ese mes. Las barras semanales usan una escala común y particionan todos los pedidos entre entregados, no entregados, anulados y sin cierre. La tasa de entrega divide por todos los pedidos creados, incluidos los abiertos.

Con guía no significa despachado físicamente. Una liquidación no significa depósito bancario confirmado. Los pedidos con múltiples liquidaciones se excluyen de los importes y se señalan para revisión. Los importes del panel son CRC; los gastos en otra moneda no se convierten sin una tasa validada y bloquean los ratios de gasto combinado.

La publicidad actual procede de los gastos `ads` registrados en Gestión, por su fecha de gasto. No acredita cobertura completa ni es un conector de Meta/TikTok. El costo combinado por pedido incluye fuentes orgánicas. No representa CPA atribuido ni CAC de clientes nuevos.

El margen registrado solo usa pedidos con una liquidación y sus costos de producto. Se oculta si faltan costos de productos entregados; el saldo parcial también se oculta sin gastos publicitarios locales o con liquidaciones duplicadas. El saldo no incluye costos pendientes de liquidar, nómina ni otros gastos. No es utilidad final.

## Conexiones pendientes

| Fuente | Acceso y correspondencia necesarios |
| --- | --- |
| Meta Ads | Cuenta publicitaria, acceso de lectura a reportes, moneda, zona horaria y campañas de Costa Rica si la cuenta es compartida. |
| TikTok Ads | Anunciante, acceso de lectura a reportes, moneda, zona horaria y campañas de Costa Rica si la cuenta es compartida. |
| ShipHero | Acceso de lectura a inventario, cuenta/almacenes de Costa Rica, correspondencia de SKU e interpretación de disponible/comprometido. |
| Icomfly y páginas de venta | Validar captura y persistencia de UTMs, origen e identificadores de anuncio/campaña junto al pedido. |
| Reposición | Fechas y cantidades previstas de entrada para comparar cobertura con plazo de reposición. |

Los conectores de lectura están implementados en `lib/marketing-sources.ts` y se consultan mediante `GET /api/marketing/sources?store=mireva-cr&month=YYYY-MM`. Su activación y verificación en vivo requieren configurar los accesos del servidor. Cada fuente indica pendiente, consulta completada o error; una fuente fallida no impide consultar las otras. Las respuestas incompletas, la paginación truncada y los errores se muestran sin datos, nunca como gasto o stock cero. Nunca introducir tokens en el navegador, documentos o código versionado.

| Fuente | Variables del servidor |
| --- | --- |
| Meta | `META_CR_AD_ACCOUNT_IDS` (IDs separados por comas), `META_CR_ACCESS_TOKEN`, `META_CR_GRAPH_VERSION` (versión Graph explícita). `META_CR_APP_ID` conserva el ID de la app para su configuración. Se admite `META_CR_AD_ACCOUNT_ID` como respaldo para una sola cuenta. |
| TikTok | `TIKTOK_CR_ADVERTISER_ID`, `TIKTOK_CR_ACCESS_TOKEN`. Se usa la API v1.3 documentada por el SDK oficial. |
| ShipHero | `SHIPHERO_CR_ACCESS_TOKEN`, `SHIPHERO_CR_ACCOUNT_ID`, `SHIPHERO_CR_WAREHOUSE_ID`. Cuenta y almacén explícitos; los datos devueltos deben coincidir con ambos. |

El alcance confirmado incluye las cinco cuentas Meta de la imagen del dueño: Arqui Nexo DC003 CR4, Arqui Nexo DC003, Arqui Nexo DC003 CR2, Arqui Nexo DC003 CR3 y Arqui Nexo DC003 CR5. Todas son exclusivas de Mireva Costa Rica. Sus IDs, el ID de aplicación y el token están configurados localmente y su lectura real fue verificada. Se fijó Graph `v26.0`, contrastada con la [configuración del SDK oficial de Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/apiconfig.py). La configuración deberá aplicarse también al entorno de despliegue al publicar.

El conector admite hasta diez cuentas y elimina IDs repetidos para no duplicar inversión. Un mismo token necesita acceso a todas las cuentas configuradas; si alguna falla, Meta se muestra con error y sin resultados parciales que pudieran confundirse con el total. Cada cuenta conserva sus campañas, moneda y zona horaria por separado.

### Verificación de Meta, 2026-10-29

La verificación final del 29/10/2026 a las 15:31 de Lima confirmó HTTP 200 en las cinco consultas de cuenta y sus cinco consultas Insights. `/me/permissions` confirmó `ads_read` y `ads_management` concedidos. Las cuentas reportan en USD y `America/Costa_Rica`; octubre devolvió 42 campañas en total: CR4 (8), DC003 (12), CR2 (5), CR3 (6), CR5 (11). El lector local está operativo. Se conserva la separación entre gasto publicitario en USD y operación en CRC hasta definir una conversión monetaria validada. La API no solicitó `appsecret_proof`; no se pidió ni almacenó la clave secreta de la app. La evidencia local está en `output/marketing/meta-live-check.json`, sin tokens. Producción, TikTok y ShipHero siguen pendientes.

Las campañas se consultan por mes en el calendario y moneda nativos de cada cuenta. Se muestran inversión, impresiones y clics; no se presentan conversiones ni atribución de entregas sin un vínculo validado. El inventario es una consulta actual, incluso cuando se selecciona un mes histórico. Solo se cruza por una coincidencia única de SKU normalizado; ausencia o ambigüedad no equivalen a cero. Los conectores no modifican campañas, presupuestos o inventario. El usuario dispone de credenciales de la interfaz de ShipHero; falta validar el acceso API, sin solicitar ni versionar su contraseña.

Referencias de implementación: [SDK oficial de Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py), [reportes oficiales de TikTok](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/ReportingApi.md), [cuentas TikTok](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AccountManagementApi.md), [consulta de inventario ShipHero](https://developer.shiphero.com/schema/queries/warehouse-products.html).

Para incorporar publicidad a los ratios de rentabilidad, conservar gasto diario por cuenta/campaña/anuncio y moneda original. Antes de calcular resultados en CRC, definir conversión monetaria y calendario común. Una futura importación persistida deberá usar claves estables con actualización idempotente y reemplazar el gasto manual cubierto para evitar sumarlo dos veces. Actualmente los reportes se consultan en lectura y se presentan aparte. La atribución de cada plataforma deberá conservar su ventana y presentarse separada del total de pedidos únicos. Sin un vínculo validado, un pedido permanece sin atribuir.

El inventario se conserva por cuenta, almacén y SKU, con fecha de sincronización. La cobertura debe usar unidades disponibles para vender y una demanda definida; no contabilizar unidades comprometidas dos veces ni repartir el mismo stock compartido íntegro a varias tiendas. Las alertas serán informativas hasta validar las conexiones; este panel no cambia presupuestos ni pausa campañas.
