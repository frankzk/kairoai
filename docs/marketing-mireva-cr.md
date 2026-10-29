# Marketing de Mireva Costa Rica

## Publicación inicial, 2026-10-29

Panel publicado en [Marketing de Kairo](https://kairoai-pearl.vercel.app/admin/marketing), mediante [PR 308](https://github.com/frankzk/kairoai/pull/308), commit de producción `41f560bb25dbf1213f88b30f4a0a21132c4dcf00`. Vercel confirmó `READY` para `dpl_F52Brwr5D5ajJ8yCpkJfVrMWJHUr` y asignó el dominio de producción. Se conservaron las correcciones previas de main y no se incluyeron los otros cambios locales pendientes.

Las cuatro variables de Meta se configuraron en Vercel Production, con el token marcado sensible. La copia aislada pasó 51 pruebas relevantes y compiló con las dependencias fijadas; GitHub CI y la vista previa de Vercel aprobaron el commit. Meta había sido verificado en lectura contra las cinco cuentas. La comprobación de la vista privada en producción quedó limitada por la falta de un inicio de sesión válido de Kairo: la credencial local no fue aceptada aun usando el acceso autenticado de Vercel. No se cambió la autenticación ni la protección del sitio. El usuario debe entrar con su usuario de Kairo autorizado para Finanzas y Costa Rica. TikTok y ShipHero siguen pendientes de conexión. La adaptación completa del bosquejo es un cambio posterior a esta publicación inicial.

## Bosquejo confirmado, 2026-10-29

El PDF de referencia propone una vista ejecutiva de ventas, CPA e inversión, resultados por producto, inventario, campañas por cuenta, tendencias y alertas. Se mantienen las cinco cuentas Meta, incluida CR3 aunque no figure en la segunda página del bosquejo.

Decisiones confirmadas por el dueño:

- La métrica principal de ventas es pedidos creados y el CPA principal usa pedidos creados como denominador. Entregas, confirmaciones y cobro se muestran aparte.
- Cada campaña anuncia un solo producto. Los nombres no siempre lo identifican: la relación campaña-producto deberá asignarse y guardarse desde Kairo.
- Umbrales globales: alerta de CPA superior a US$8.50 y stock disponible menor a 100 unidades.
- Los filtros solicitados incluyen hoy, ayer, últimos 7/14/28/30 días, mes pasado y calendario; tablas ordenables y filtros de producto.

Decisiones adicionales confirmadas: asignación editable de campaña a producto en Kairo; columna presupuesto con el presupuesto diario vigente, sumando conjuntos cuando corresponda; ventas sin evidencia de origen como «Sin atribuir» hasta poder distinguir orgánico y upsell. No se infiere que una venta sea orgánica por diferencia entre reportes publicitarios y pedidos. Las oportunidades de escala y alertas de inventario requieren stock real y un mínimo de evidencia antes de presentarse como recomendaciones. Esta adaptación del bosquejo es posterior a la publicación inicial del panel y la lectura de las cinco cuentas.

Primera tienda: `mireva-cr`. Panel integrado en `/admin/marketing`, accesible con el permiso independiente `marketing` y el acceso a Costa Rica. El acceso aparece en la barra de Kairo para esas personas. API: `GET /api/marketing/summary?store=mireva-cr&month=YYYY-MM`.

## Datos disponibles

El panel reutiliza el dataset conciliado de Gestión y sus reglas para unir Icomfly, histórico de Shopify, logística y liquidaciones. No crea pedidos a partir de reportes de publicidad o stock. La API devuelve agregados y productos, sin nombres de clientes, teléfonos ni identificadores de pedidos.

El mes corresponde a la fecha de creación del pedido en `America/Costa_Rica`, con límites inclusivo/exclusivo a medianoche de Costa Rica. Los estados corresponden al último dato operativo disponible, no al día de cierre histórico de ese mes. Las barras semanales usan una escala común y particionan todos los pedidos entre entregados, no entregados, anulados y sin cierre. La tasa de entrega divide por todos los pedidos creados, incluidos los abiertos.

Con guía no significa despachado físicamente. Una liquidación no significa depósito bancario confirmado. Los pedidos con múltiples liquidaciones se excluyen de los importes y se señalan para revisión. Los importes operativos son CRC; los gastos en otra moneda no se convierten sin una tasa validada y bloquean los ratios financieros basados en gastos manuales.

La inversión principal del resumen procede de las cuentas consultadas en Meta y TikTok, en su moneda nativa. Se suman las cinco cuentas Meta USD y se divide por todos los pedidos creados del mes. Hasta conectar TikTok, la inversión y los costos se identifican como parciales. Un reporte fallido o pendiente no equivale a gasto cero. Si hay distintas monedas o calendarios incompatibles con Costa Rica, no se calcula un CPA combinado; la inversión permanece desglosada por moneda. Los gastos manuales `ads` de Gestión se conservan aparte para el saldo financiero CRC, sin sumarlos a las plataformas. El costo combinado por pedido incluye fuentes orgánicas. No representa CPA atribuido ni CAC de clientes nuevos.

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

La verificación del 29/10/2026 a las 15:31 de Lima confirmó HTTP 200 en las cinco consultas de cuenta y sus cinco consultas Insights. `/me/permissions` confirmó `ads_read` y `ads_management` concedidos. Las cuentas reportan en USD y `America/Costa_Rica`; octubre devolvió 42 campañas en total: CR4 (8), DC003 (12), CR2 (5), CR3 (6), CR5 (11). Se conserva la separación entre gasto publicitario en USD y operación en CRC hasta definir una conversión monetaria validada. La API no solicitó `appsecret_proof`; no se pidió ni almacenó la clave secreta de la app. La evidencia local está en `output/marketing/meta-live-check.json`, sin tokens. El panel y la configuración Meta se publicaron posteriormente en la misma fecha; TikTok y ShipHero siguen pendientes.

Las campañas se consultan por mes en el calendario y moneda nativos de cada cuenta. Se muestran inversión, impresiones y clics; no se presentan conversiones ni atribución de entregas sin un vínculo validado. El inventario es una consulta actual, incluso cuando se selecciona un mes histórico. Solo se cruza por una coincidencia única de SKU normalizado; ausencia o ambigüedad no equivalen a cero. Los conectores no modifican campañas, presupuestos o inventario. El usuario dispone de credenciales de la interfaz de ShipHero; falta validar el acceso API, sin solicitar ni versionar su contraseña.

Referencias de implementación: [SDK oficial de Meta](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py), [reportes oficiales de TikTok](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/ReportingApi.md), [cuentas TikTok](https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/docs/AccountManagementApi.md), [consulta de inventario ShipHero](https://developer.shiphero.com/schema/queries/warehouse-products.html).

Para incorporar publicidad a los ratios de rentabilidad, conservar gasto diario por cuenta/campaña/anuncio y moneda original. Antes de calcular resultados en CRC, definir conversión monetaria y calendario común. Una futura importación persistida deberá usar claves estables con actualización idempotente y reemplazar el gasto manual cubierto para evitar sumarlo dos veces. Actualmente los reportes se consultan en lectura y se presentan aparte. La atribución de cada plataforma deberá conservar su ventana y presentarse separada del total de pedidos únicos. Sin un vínculo validado, un pedido permanece sin atribuir.

El inventario se conserva por cuenta, almacén y SKU, con fecha de sincronización. La cobertura debe usar unidades disponibles para vender y una demanda definida; no contabilizar unidades comprometidas dos veces ni repartir el mismo stock compartido íntegro a varias tiendas. Las alertas serán informativas hasta validar las conexiones; este panel no cambia presupuestos ni pausa campañas.

### Corrección del resumen publicitario, 2026-10-29

El resumen inicial solo leía gastos manuales CRC aunque Meta ya estuviera conectado. Se corrigió para mostrar inversión y costo por pedido creado desde los reportes conectados, con cobertura parcial explícita hasta incorporar TikTok. La comprobación en lectura a las 15:51 de Lima devolvió las cinco cuentas y USD 20,714.85 de inversión en octubre; las cuentas comparten el calendario de Costa Rica. Pasaron 32 pruebas de marketing y la compilación con Next 14.2.35. La captura del usuario confirma acceso al panel privado publicado; no se automatizó una sesión de producción para esta corrección.

### Permiso independiente de Marketing, 2026-10-29

Usuarios ofrece la casilla Marketing para conceder el dashboard sin Finanzas ni Gestión. La página y ambas API exigen `marketing`; el acceso a Mireva Costa Rica sigue siendo necesario. Al guardar, la sesión aplica el cambio en la siguiente revalidación (hasta 30 segundos). El rol Administrador incluye el nuevo permiso y las sesiones firmadas del administrador legado reciben el catálogo actualizado sin extender su vencimiento. Los roles de Finanzas no conceden Marketing automáticamente: se marca explícitamente en cada persona. Los enlaces del dashboard hacia Gestión solo aparecen si la persona también puede acceder a ella. No se cambiaron permisos guardados de ninguna persona.

## Dashboard del bosquejo, 2026-10-29

Tres vistas: Resumen operativo; Productos y campañas; Tendencias y reposición. Conserva el permiso independiente Marketing y la restricción de tienda Mireva Costa Rica. El resumen muestra pedidos creados, inversión consultada y costo combinado por pedido; entrega y pendientes son estados actuales de esa cohorte. Los períodos disponibles son hoy, ayer, semana de lunes a hoy, mes a la fecha, mes anterior, últimos 7/14/28/30 días y rango personalizado de hasta 93 días. Todos usan Costa Rica. La comparación anterior toma el mismo número de días; hoy puede estar incompleto. Los filtros se guardan en la URL; un preset relativo se recalcula al abrir o actualizar la página.

La tabla de campañas permite filtrar por cuenta, buscar, ordenar y asignar un producto del catálogo canónico de Costa Rica. La relación se guarda por tienda, plataforma, cuenta y campaña, nunca solo por nombre. No modifica anuncios ni presupuestos. El presupuesto mostrado es el diario actual en la moneda de la cuenta: presupuesto de campaña cuando existe, o suma de conjuntos activos; no se divide un presupuesto de duración para inventar un diario. Un fallo en presupuestos no invalida la inversión consultada. La lectura de presupuestos se verificó contra las cinco cuentas reales (77 campañas en el catálogo).

El costo por producto suma la inversión de sus campañas asignadas y la divide por pedidos creados que contienen ese producto, contando cada pedido una sola vez por producto. No reparte pedidos entre campañas. Se separan las compras reportadas por Meta, con ventana de 7 días clic y 1 día vista, de los pedidos de Kairo. No se deduce origen orgánico o upsell por resta. Los importes de distintas monedas no se suman. Un reporte no disponible no se sustituye por cero.

El usuario confirmó productos/campañas prioritarios, objetivos globales de CPA USD 8.50 y stock 100, y planificación de reposición a proveedores. Se puede marcar prioridad por producto y guardar proveedor, plazo, cobertura tras llegada y unidades en camino manuales. Demanda diaria = unidades pedidas durante los siete días completos que terminan ayer, excluyendo anulados, divididas por siete. El punto de reposición es el mayor entre 100 y la demanda durante el plazo. Si stock disponible más entrante cae por debajo, la sugerencia cubre plazo y cobertura, con mínimo de 100, restando stock y entrante. Sin stock real, demanda reciente o plazos explícitos no se recomienda una cantidad. Las coincidencias ambiguas de SKU se consideran desconocidas. El plan no crea órdenes de compra.

Las señales incluyen costo alto por producto, stock bajo, clics sin compras reportadas, crecimiento de demanda, preparación de reposición y revisión para escalar. Esta última requiere al menos siete días, 20 pedidos, costo USD dentro del objetivo, demanda no decreciente, stock real suficiente, ambas plataformas consultadas y todas las campañas con gasto asignadas. Las señales requieren revisión de atribución y margen antes de actuar. No cambian presupuestos automáticamente.

Persistencia: GET/PATCH /api/marketing/settings?store=mireva-cr, tablas marketing_campaign_products y marketing_product_plans, migración 20261029212108_marketing_campaign_products_and_replenishment.sql aplicada en el proyecto xxqunqnicvjhnwbnyghe. RLS habilitada, sin accesos anon/authenticated, acceso exclusivamente de servidor con validación de identidad Marketing y tienda. Se verificó lectura con las credenciales del servidor y escritura en una transacción revertida. Los únicos avisos del asesor relativos a estas tablas son informativos: RLS sin políticas, intencional porque solo service_role accede. No se guardaron asignaciones ni planes inventados.

Validación: suite completa de 1.511 pruebas, TypeScript y compilación local aprobados. Lectura real de pedidos: 3.201 en octubre hasta el día 29, igual a la suma diaria, 208 productos en catálogo, sin devolver PII. Playwright verificó las tres vistas, guardado local de asignación y reposición con respuestas de prueba, filtro de ayer y fechas cruzando meses; escritorio y móvil 390px sin desbordamiento del documento ni errores JS. Estas capturas son de QA local con fixtures, no acreditan sesión privada de producción. TikTok y ShipHero siguen pendientes de credenciales API; el stock y las cantidades sugeridas permanecen desconocidos mientras no se conecten.

## Metodología Charlie y USD, 2026-10-29

El dashboard incorpora Decisión financiera, Matriz 4Pi, Control y Testing y Sustracción. Conserva productos, asignaciones, presupuesto diario y reposición. Todos los reportes monetarios se presentan en USD usando referencia oficial de Hacienda o planificación manual, con fecha visible. El valor de pedidos creados se identifica como ingreso potencial. La documentación vigente de fórmulas, recurrencia, límites de Harvest, protección y verificación está en [marketing-charlie.md](marketing-charlie.md). Esta ampliación sustituye la presentación previa en monedas nativas; no cambia la moneda de los registros de origen.
