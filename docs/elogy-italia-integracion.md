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

Verificación de esta entrega: 1.317 pruebas de Vitest, TypeScript, lint y build
correctos. Navegador: todas las pestañas, paginación de 50 filas, búsqueda,
CSV, costos con concurrencia, gastos y abonos simulados, error de lectura y
móvil sin desbordar la página. SQL aislado: también gasto EUR e idempotencia.

### Costo provisional autorizado por el dueño

El dueño solicitó 9 EUR por unidad para todos los SKU mientras no dispone de
costos de compra. Se registra provisional=true tanto en el costo vigente como en
cada versión histórica, con actor y solicitud idempotente. Vigencia desde el
primer pedido del histórico para poder estimarlo; no representa evidencia de
precios históricos reales. Sin empaque propio adicional informado (0 EUR);
cargos company reales de Elogy separados. Tres unidades cuestan 27 EUR y cinco
45 EUR de producto, incluidos regalos.

La interfaz y el CSV identifican las estimaciones. La contribución calculable
puede consultarse como estimada; el resultado completo sigue pendiente mientras
haya costos provisionales u otros datos sin resolver. Al editar un costo, el
operador puede desmarcar provisional al contar con un importe comprobado. Las
versiones anteriores se conservan y la fecha de vigencia usa el día de Italia.
Los costos de Honduras y Costa Rica no cambian.

Cargados 22 SKU a 9 EUR/unidad provisional con vigencia 2025-09-03 (primer
pedido del histórico disponible), empaque propio adicional 0 EUR y auditoría
exclusiva de kenku-it. Verificados 1.320 tests, TypeScript, lint, build y QA de
navegador con guardados simulados. Elogy en producción: cron 200 sin error;
primera ejecución programada validada. La cuenta técnica QA quedó desactivada.

## Conciliación de liquidaciones y banco (26 octubre 2026)

El dueño aplazó la entrega de extractos. Se deja preparada la herramienta; no se
crea ninguna liquidación ni abono real y no se da por conciliado un mes vacío.
Los 9 EUR de producto siguen siendo provisionales. El cierre de tesorería de una
remesa es independiente de completar costos, comisiones online e inventario.

### Recorrido

1. Nueva liquidación: referencia, fecha del extracto y neto declarado por Elogy.
2. Vincular únicamente sus cobros Collected COD y cargos company, por identidad
   del proveedor. El buscador paginado consulta todas las partidas sin asignar;
   admite hasta 100 por operación y conserva importes del servidor.
3. Registrar cualquier ajuste que figure en el extracto con motivo y referencia
   del comprobante. La confirmación del detalle es explícita. Cambiar sus
   partidas retira esa confirmación.
4. Banco: fecha valor, alias estable de cuenta, referencia bancaria única,
   importe original, moneda y referencia de extracto/comprobante. EUR conserva
   exactamente el importe recibido. USD/GBP conservan el original y quedan sin
   asignar hasta disponer de un contravalor documentado en EUR; no se inventa FX.
5. Asignar abonos completos o parciales. Un abono puede repartir su saldo entre
   varias liquidaciones y una liquidación recibir varios abonos. El total usado
   nunca puede superar el contravalor comprobado del abono.
6. Cerrar la liquidación solo cuando detalle confirmado, neto declarado y banco
   coinciden al céntimo. Una remesa neta cero exige detalle y comprobante, aunque
   no necesite abono. Cierre no realiza transferencias ni cambia estados Elogy.
7. Reabrir o retirar vínculos requiere motivo y auditoría. Movimientos bancarios
   equivocados pueden anularse solo después de retirar sus asignaciones. No se
   borran movimientos ni auditoría. Los registros cerrados requieren reapertura.

La interfaz muestra: Liquidaciones, Banco y Cobros por revisar. La revisión
separa entregados COD sin cobro, cobros parciales/superiores, cobros con devolución,
cobros COD en pedidos online y cobros sin envío en el espejo. Son alertas para
revisar, no pérdidas confirmadas. Se conserva el origen de Elogy y el estado
original de Shopify. Los CSV corresponden a cada vista.

### Periodos y diferencias

Remesas por fecha de extracto; banco por fecha valor de cada abono, no por la
fecha del último abono de toda la liquidación. Un abono comprobado sin asignar
figura como recibido y disponible. El importe asignado es otro dato separado.
La consulta mensual incluye remesas con extracto o algún abono en ese periodo.
Un cambio posterior del importe/pedido de Elogy se señala incluso después del
cierre: el snapshot del extracto no se sobrescribe silenciosamente.

No se deduce un pago al comercio restando todos los cargos del mes a todos los
cobros. Elogy Virtual Balance contiene movimientos internos y recargas; no se
trata como evidencia de ingreso bancario. Sin extractos no se enlazan partidas,
no se introducen ajustes y no se confirman abonos reales.

### Persistencia, seguridad y verificación

Migración 20261026050848_italia_elogy_conciliacion: partidas por liquidación,
movimientos bancarios y asignaciones privadas con RLS y sin privilegios de
anon/authenticated. RPC SECURITY INVOKER exclusiva del servidor, restringida a
kenku-it y finanzas, con Origin validado, actor del servidor, UUID, revisiones,
bloqueo transaccional y snapshots de auditoría. Un mismo cobro/cargo no puede
pertenecer a dos remesas; referencia bancaria es única por alias de cuenta.

Las partidas se validan antes de insertar cualquier elemento del lote y se
bloquean durante su lectura para evitar cambios concurrentes del espejo. La
asignación de saldo es atómica y un cierre vuelve a comprobar fuente y totales.
El antiguo atajo de registrar recibido_cents sin movimiento vinculado queda
bloqueado en la API y la RPC. La protección de Origin admite el Host que Next
realmente enruta, sin confiar en forwarded-host arbitrarios.

El conector de migraciones devolvió requestState caducado. Se utilizó la CLI
oficial ya autenticada, enlazada explícitamente a xxqunqnicvjhnwbnyghe, con la
migración y su fila de historial en una sola transacción, lock_timeout de 5s y
statement_timeout de 60s. Versión aplicada verificada por consulta independiente.

SQL probado en PostgreSQL 17 aislado: RLS/grants, lote inválido sin inserción
parcial, doble asignación de cobros, duplicados bancarios, FX ausente, abonos
parciales entre meses, límites de saldo, versiones, cierre/reapertura, cambios
posteriores de Elogy, bloqueo del atajo anterior y separación de tiendas.
Las pruebas de navegador usan solo escrituras simuladas. No se registran
movimientos financieros reales para QA.

Verificación de la conciliación: 1.342 pruebas, TypeScript, lint y build correctos.
Navegador con fuentes reales y escrituras simuladas: confirmación, dos abonos
parciales entre meses, cierre/reapertura, añadir/retirar cargos, registrar/anular
abono, completar contravalor, paginación/búsqueda de fuentes y diferencias, CSV,
móvil y bloqueo de escrituras ante error de lectura. El histórico se redujo de
5,30 MB a 3,30 MB proyectando solo columnas de pantalla. Candidatos se consultan
por páginas de 50 y no añaden su histórico completo a esa respuesta.
Los registros de banco y liquidaciones reales permanecen vacíos, como pidió el
dueño al aplazar los extractos. Evidencias privadas elogy-conciliacion-*.

## Conciliación de pedidos Shopify con seguimiento Elogy (29-10-2026)

Gestión de Italia consulta `italia_orders_reconciled`, una proyección de lectura
sobre los pedidos originales y el espejo de envíos Elogy. El enlace exige tienda,
referencia normalizada exacta (solo espacios externos, prefijo # y mayúsculas),
un pedido de origen único y un envío único. No se cruza por nombre, teléfono,
importe aproximado ni identificadores numéricos compartidos entre plataformas.

Los estados de Elogy se muestran con su etiqueta original, guía, courier, fecha
del seguimiento y fecha de lectura. Created se presenta como En preparación;
In transit como Enviado; reparto, incidencia, devolución en curso, entregado y
devuelto tienen estados diferenciados. Un lead sin envío no se supone confirmado
ni entregado: puede existir en Elogy y aún carecer de seguimiento conciliable.

La lista, búsqueda por guía, filtros y contadores usan la misma proyección. Los
contadores se agrupan en una única RPC de lectura y una sola instantánea por
ámbito, sin traer payloads al navegador. El estado de WooCommerce conserva su
flujo CRM. México/Argentina mantienen sus filtros y fuentes anteriores.

Se preservan payloads de Shopify, datos originales de pago/preparación, versiones,
notas, gestión manual y claves de origen. Una anulación/reembolso, un estado
terminal manual contradictorio, una regresión de entrega/despacho, moneda/importe
diferentes, referencia duplicada, varios envíos o seguimiento desconocido no se
resuelven eligiendo arbitrariamente: se conservan y señalan para revisión. No se
escriben estados de Shopify/Elogy, no se confirman clientes ni se solicitan envíos.
El formulario de gestión sigue editando el estado base de Kairo y conserva su
control de concurrencia; la etiqueta logística de la lista no cambia ese contrato.

Migraciones: 20261029171044_italia_pedidos_conciliados_elogy y
20261029171910_italia_conciliacion_contadores. Vista security_invoker y RPC
security invoker/stable con search_path vacío; sin permisos anon/authenticated,
solo lectura de service_role en el servidor. Las tablas base conservan su RLS.
Reversión: desplegar la API anterior, que sigue leyendo italia_orders; la vista
base y los pedidos no se alteraron. No restaurar bases históricas.

Validación al aplicar: 6.286 registros conservados (6.281 Shopify/5 Woo), 4.647
coincidencias de seguimiento, 14 diferencias (10 estados protegidos y 4 importes),
1.620 sin seguimiento conciliable. Shopify: 2.787 entregados, 1.621 devueltos,
160 en devolución, 98 enviados, 26 en reparto, 24 incidencias, 14 en preparación,
306 pendientes y 1.245 anulados. Son una instantánea del espejo; el cron existente
continúa actualizándolo. La pantalla indica última lectura y último recorrido
completo; no promete un histórico completamente refrescado cada cinco minutos.

Pruebas: 47 comprobaciones SQL reproducibles con PostgreSQL 17 aislado, red none,
sin datos reales; 1.418 pruebas de proyecto, TypeScript, lint y build. La batería
incluye referencias ambiguas, estado desconocido, regresiones, importes/monedas,
actualización del espejo, persistencia original, límites por tienda y permisos.
Navegador y despliegue se documentan al verificar la publicación.

QA de navegador local con datos reales y autenticación normal: filtros de entregados,
cola de 14 diferencias con detalle y ambos importes, búsqueda exacta por guía,
paginación sin repetir contadores, móvil sin overflow, interfaz México conservada
y API anónima protegida. Cero errores JS y cero escrituras de pedidos. Evidencia
privada en output/playwright/kenkuit/pedidos-conciliados-local-qa.json y capturas.
Los campos ADMIN_PASSWORD/AUTH_SECRET vacíos del .env de PC se completaron solo
en el proceso efímero de QA con la alternativa APP_SECRET prevista por la app;
no se modificó autenticación ni configuración productiva. 47 casos SQL y 1.418
pruebas verificados al cierre; publicación y smoke productivo se registran después.
