# Elogy: logística y finanzas de Kenku Italia

Implementación del 25–26 de octubre de 2026. La clave Rest API fue validada
mediante consultas GET y guardada como secreto sensible de producción en Vercel.
Es distinta de la clave WooCommerce que Elogy utiliza para consultar la tienda.
No se necesita la contraseña de Elogy. Ningún valor secreto está versionado.

## Fuentes verificadas

Documentación oficial enlazada por Elogy:
https://documenter.getpostman.com/view/198132/TVRq36Yh

La autenticación usa Authorization con la clave sin prefijo Bearer. El cliente
restringe hosts, rechaza redirecciones, aplica timeout y devuelve códigos técnicos
sin cuerpos privados. Se conserva una lista explícita de campos; no se guardan
IP, direcciones completas, credenciales ni URLs firmadas del proveedor.

| Fuente | Host y ruta | Paginación / filtro |
| --- | --- | --- |
| Pedidos y líneas | api.elogy.io/api/orders | offset, length=100 |
| Envíos y seguimiento | api.elogy.io/api/shipped | offset, length=100 |
| Cobros del courier | batch.elogy.io/api/cods | $skip, $top=100, type=matched |
| Cargos al comercio | batch.elogy.io/api/billings | $skip, $top=100, type=company |

Los reportes batch se verificaron contra el cliente público de Elogy y lecturas
autenticadas. offset/length no pagina estos reportes. El endpoint documentado
companyBillings agotó su timeout; no se usa. shippedCod enumera envíos COD y no
acredita cobros. returnsV2 no entregó filas verificables: las devoluciones se
clasifican por seguimiento de envíos. Un cambio de contrato falla explícitamente,
no convierte una respuesta inesperada en una lista vacía.

Los cargos existen en tres tarifas: company, general y platform. Solo company
corresponde al comercio. Sumarlas triplicaría los cargos. shipping_price no es
un costo logístico y el valor de una línea no es su costo de compra.

## Persistencia y actualización

Migración 20261026043025_italia_elogy_operacion.sql, aplicada al proyecto Kairo.
Cuatro tablas privadas con RLS, sin privilegios anon/authenticated y funciones
SECURITY INVOKER exclusivas del servidor. Todo se restringe al store activo
kenku-it. Solo referencias KIT y país IT cuando el proveedor lo informa.

Cada recurso tiene cursor, lease de cuatro minutos y hash de página. Las filas
se actualizan por identidad del proveedor, protegidas frente a eventos antiguos.
Reintentos idempotentes; una página repetida no avanza el cursor. Un error libera
el lease conservando el punto de reanudación. El espejo conserva historia: la
ausencia en una página no significa cancelación.

scripts/elogy-worker.py consulta /api/cron/elogy desde el VPS Italia cada cinco
minutos con el secreto exclusivo de sincronización de Italia ya existente. La API
key de Elogy permanece en Vercel. Se rechazan redirecciones y destinos distintos
al origen fijo Kairo. flock evita solapamientos. Salud de procesos registra el cron.

Cada ejecución avanza hasta diez páginas por recurso, con presupuesto total de
240 segundos. Un recorrido histórico completo puede necesitar varias ejecuciones.
La pantalla distingue última página leída y último recorrido completo. No se
promete refrescar todos los históricos cada cinco minutos. Sync Elogy avanza dos
páginas por recurso; Actualizar lee la copia de Kairo.

Carga inicial: 4.699 pedidos, 4.635 filas de envíos, 2.537 cobros y 4.635 filas
company. Tras deduplicación por identidad: 4.634 envíos y 4.634 cargos. Todos los
envíos coinciden por referencia exacta con pedidos de Kairo. Se señalan referencias
ausentes o ambiguas; no se cruza por nombres parecidos ni se recortan prefijos.

## Herramientas y límites contables

- Logística: guía, courier, seguimiento italiano original, fecha, cliente,
  COD/online, cruce con Kairo, búsqueda, filtros, paginación y CSV. Código 19:
  entregado; 19.1: devuelto al remitente. Desconocido no equivale a entregado.
- Liquidaciones: cobros matched por fecha valor; remesas del extracto registradas
  manualmente; recepción bancaria y diferencia por abono. Un cobro del courier
  no prueba una transferencia bancaria. Remesas por fecha del extracto y banco
  por fecha real del abono, incluso si corresponden a meses diferentes.
- Costos SKU: EUR, empaque propio por unidad, vigencia e historial. Costo vigente
  en fecha original del pedido para todas las unidades, incluidos regalos de
  ofertas de 3 y 5. Cargos de Elogy separados.
- Gastos: registro de publicidad, personal y otros en EUR por fecha. No se inventan
  gastos ausentes. Esta entrega agrega registros; no incluye editar/borrar gastos
  ni un módulo de nómina.
- Rentabilidad: venta entregada menos cargo company y costo de productos. Muestra
  contribución conocida y cada motivo de datos pendientes.
- Cierre mensual: consulta y CSV del resultado operativo antes de impuestos. No
  es un cierre contable bloqueado ni una declaración fiscal.

Inicialmente no hay costos de compra configurados para los 22 SKU detectados.
No se inventa costo cero. Comisiones de pagos online requieren su fuente real;
devoluciones/cancelaciones requieren cierre de inventario y costo recuperado.
Sin esos datos el resultado completo permanece Pendiente. Este lanzamiento no
automatiza comisiones Stripe ni cierre de inventario de retornos.

Costo y recepción bancaria comprueban versión/updated_at. Toda mutación usa UUID,
actor del servidor y auditoría antes/después. Reintentar no duplica gastos o
remesas; referencia de remesa duplicada se rechaza. No hay asignación automática
de cobros a remesas sin desglose de extracto verificable, ni importación bancaria.
Los formularios no realizan transferencias ni cargos.

## Permisos y operación

Acceso a pedidos/finanzas y Kenku Italia. Logística disponible para operación;
costos, gastos, banco y rentabilidad exigen finanzas. El DTO operativo excluye
esos datos. El servidor valida permisos y Origin y fija tienda, moneda y actor.

La integración solo lee Elogy: no crea, confirma ni despacha pedidos. No cambia
estados originales de Shopify ni devuelve seguimiento a WooCommerce. Se conserva
la restricción de Woo que permite a Elogy leer únicamente pedidos confirmados por
Kairo. No se cambia DNS ni se activa Stripe o mensajería.

## Verificación

Pruebas: cliente, normalización, cantidades gratis, costos históricos, monedas,
datos ausentes, periodos bancarios, rutas/CSRF/permisos y cron. SQL probado en
PostgreSQL 17 aislado: RLS/grants, leases, eventos antiguos, idempotencia, versiones
de costo, banco y aislamiento. La versión local coincide con la migración aplicada.
RLS sin políticas es intencional en estas tablas exclusivas del servidor.

QA local de navegador con lecturas reales y guardados financieros simulados,
sin crear costos, cobros, gastos ni pedidos reales. Evidencias privadas en
output/playwright/kenkuit/elogy-*, excluidas del repositorio.

Verificación de esta entrega: 1.315 pruebas de Vitest, TypeScript, lint y build
correctos. Navegador: todas las pestañas, paginación de 50 filas, búsqueda,
CSV, costos con concurrencia, gastos y abonos simulados, error de lectura y
móvil sin desbordar la página. SQL aislado: también gasto EUR e idempotencia.
