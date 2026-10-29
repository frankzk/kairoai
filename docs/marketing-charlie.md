# Marketing Mireva Costa Rica: metodología Charlie

Implementación del 29/10/2026 sobre el dashboard del PDF. El dueño confirmó: valor de pedidos creados como **ingreso potencial**, roles Control/Testing detectados por nombre y corregibles, Hero Offer todavía sin definir y todos los reportes en USD.

## Vistas y cálculos

1. **Decisión financiera**: Profit Volume potencial = ingreso potencial menos inversión consultada; GPT potencial = AOV potencial menos CPA combinado; CPA = inversión consultada / pedidos creados; Headroom = USD 8.50 menos CPA. Sin pedidos, CPA/GPT quedan sin datos. El ingreso incluye el valor original de pedidos posteriormente anulados y se informa ese riesgo. Ninguno de estos cálculos representa utilidad neta, cobro ni margen después de producto, logística, devoluciones, nómina y otros costos.
2. **Matriz 4Pi**: gasto, CPM, compras, CPA y GPT reportados por Meta por anuncio. La frecuencia corresponde exactamente al día seleccionado: no se suman ni promedian frecuencias diarias. Los umbrales de prospecting/retargeting son orientativos; no prueban la audiencia ni revelan decisiones del algoritmo. Compras de Meta usan ventana 7 días clic / 1 día vista y se distinguen de pedidos de Kairo. Cero compras deja CPA/GPT nulos.
3. **Control y Testing**: muestra estructura CBO/ABO real, anuncios activos, Post IDs actuales y especificaciones 3:2:2 cuando Meta devuelve los activos. La clasificación automática admite corrección guardada por tienda/cuenta/conjunto; no modifica Meta. El rango 4–8 de Control es referencia, no prueba de calidad ni estabilidad histórica de Post IDs.
4. **Sustracción**: candidatos con 10–40% del gasto de su cuenta en el día seleccionado y CPA superior a USD 8.50, GPT inferior al promedio ponderado de esa cuenta, o gasto de al menos USD 8.50 sin compras reportadas. GPT ponderado = (valor total reportado menos gasto total) / compras totales. Son señales de revisión con enlace a Ads Manager; no hay pausas ni cambios de presupuesto automáticos.

Productos y campañas conserva asignación manual campaña-producto y presupuesto diario vigente. Tendencias y reposición conserva prioridades, compras a proveedores y planes existentes. Los filtros de hoy, ayer, semana, mes, mes anterior y rangos personalizados siguen usando America/Costa_Rica. Los datos anteriores se ocultan al cambiar de período mientras se consulta el nuevo rango.

## USD

Los importes USD de Meta permanecen en USD. Los importes CRC de la operación se dividen por la referencia de **venta de Hacienda** obtenida de [su API oficial](https://api.hacienda.go.cr/indicadores/tc/dolar), con fecha y origen visibles. Se admite referencia manual de planificación. La tasa nunca está fijada en código. La referencia automática se valida como positiva, no futura y de antigüedad máxima de cuatro días; caché en memoria de 15 minutos. Si no puede verificarse, los importes CRC y ratios dependientes permanecen pendientes. Los períodos históricos se reexpresan a la referencia mostrada: no son conversiones históricas ni liquidaciones bancarias.

## Recurrentes, Hero Offer y Revenue Floor

Un recurrente requiere el mismo teléfono normalizado de Costa Rica y una entrega anterior a la creación del pedido actual. Una entrega posterior o sin fecha verificable no lo acredita; fechas de entrega sin hora se consideran al final del día para evitar anticiparlas. Los teléfonos se usan solo en servidor: la API devuelve agregados sin PII. La cobertura de identificación y el historial incompleto limitan el resultado; el teléfono es un proxy, no una identidad personal verificada.

Revenue Floor suma pedidos recurrentes o de Hero Offer una sola vez. Sin Hero Offer definida, Revenue Floor permanece pendiente; la recompra se presenta por separado cuando hay evidencia. Sin fechas verificables de entrega, la recompra también queda pendiente. La verificación real encontró entregas históricas sin fecha de entrega en este dataset. No se inventa una oferta ni se interpreta este piso potencial como efectivo asegurado.

## Fuentes, límites y protección

- Lectura diaria por anuncio de las cinco cuentas configuradas, con Graph v26.0. Paginación completa y cursores reconstruidos sobre el origen confiable. Tokens solo en cabecera del servidor. Un fallo de cuenta invalida el total Meta; no se sustituye por cero.
- Caché de reportes por período: 45 segundos. Metadatos de anuncios/conjuntos: hasta cinco minutos. Credenciales y versión forman parte de claves hash internas. Los metadatos incompletos no se presentan como cero anuncios activos ni como Post IDs verificados.
- TikTok y ShipHero siguen pendientes de conexión. La inversión se marca parcial y el stock desconocido no equivale a cero. No se afirma que el resultado parcial sea rentabilidad global del negocio.
- La consulta real de desglose conjunto `image_asset,body_asset,title_asset` fue rechazada por Meta (HTTP 400, código 100). **Harvest queda pendiente de evidencia por combinación**: el gasto del anuncio no prueba que una permutación supere 60%. Los Post IDs de Testing se pueden consultar como IDs del anuncio, sin presentarlos como ganadores de combinaciones.
- Nuevas API: `/api/marketing/charlie`, `/charlie-business`, `/charlie-settings`, todas bajo `/api/marketing`, permiso Marketing y tienda Costa Rica. Respuestas privadas sin caché de navegador. La escritura valida identidad, rol y pertenencia real del conjunto a la cuenta mediante GET de Meta.
- Migración aplicada: `20261029214847_marketing_charlie_config_and_roles.sql`, tablas `marketing_charlie_config` y `marketing_adset_roles`. RLS habilitada, sin privilegios para public/anon/authenticated; acceso exclusivamente de servidor. Escritura verificada en transacción revertida; no se persistieron roles, ofertas o tasas ficticias.

## Verificación

Suite completa: 1.561 pruebas aprobadas, además de TypeScript y compilación de producción. Lectura real verificada en las cinco cuentas: moneda USD, frecuencia diaria disponible donde hay actividad y metadatos completos. Referencia Hacienda verificada el 29/10/2026. QA de escritorio y móvil e interacciones con respuestas de prueba locales; esas capturas no acreditan acceso a una sesión privada de producción. El despliegue se confirma separadamente por commit y estado READY de Vercel.
