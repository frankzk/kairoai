# Kenku Italia: pedidos WooCommerce en Kairo

Implementación del 25-10-2026, autorizada por el dueño. Tiempo no cronometrado.

## Funcionamiento

`cod-core` envía el pedido final a `POST /api/webhooks/cod-core/kenku-it`.
Se verifica HMAC SHA-256 sobre el cuerpo original, evento, origen permitido,
EUR, país IT, pago COD y estado `cod-pending`. El tamaño máximo es 256 KiB.
La tienda se resuelve en el servidor. La clave única `(store_id, woo_id)` hace
que reintentos concurrentes no dupliquen ni sobrescriban el pedido.
Solo se confirma la recepción después de persistirlo.

Gestión → Kenku Italia (`/admin/finance/italia`) conserva teléfono +39, CAP con
ceros iniciales, dirección, productos/SKU, importes EUR y hora de Italia.
Se requiere permiso pedidos/finanzas y acceso a kenku-it (o administrador legado).
No mezcla estos pedidos con los registros Shopify ni con las finanzas CR/HN.

Los estados son pendiente → confirmado → despachado → entregado, con anulación
antes de entregado. Cada cambio usa versión esperada y UUID de idempotencia,
guarda auditoría y una salida pendiente en la misma transacción. La API Woo
recibe processing / cod-shipped / completed / cancelled. El siguiente cambio
queda bloqueado hasta confirmar el anterior. Los fallos se reintentan con
espera exponencial; los leases expiran a los 90 segundos.

`cod-core` tiene activada la opción `cod_core_crm_statuses=yes`. Su revisión y
bloqueo MySQL impiden que una petición retrasada revierta un estado posterior.
Esta extensión es opt-in y está versionada en kenkuit-woo (ce32c4e).

## Configuración privada

Vercel Production contiene WOO_KENKU_IT_CONSUMER_KEY, CONSUMER_SECRET, URL,
ORIGINS, WEBHOOK_SECRET y SYNC_SECRET (todas con prefijo WOO_KENKU_IT_).
Los secretos se generaron en el VPS y se transfirieron por stdin, sin imprimirlos.
No se modificaron las variables Shopify existentes.

La URL Woo temporal es https://192-248-177-251.sslip.io. Caddy protege la tienda
con Basic Auth y noindex; su excepción REST exige las claves propias de Woo.
El origen futuro https://kenkuitalia.com también está permitido, sin mover DNS.

El worker externo `scripts/woo-status-worker.py` se instala en el VPS y se
ejecuta cada cinco minutos con flock. Lee `/root/kenkuit-kairo-secrets.json`
(0600), campo `kairo_url` y WOO_KENKU_IT_SYNC_SECRET. Invoca
`/api/cron/woo-status` con Bearer y sin seguir redirecciones. No necesita
CRON_SECRET global ni cambia la política de los otros crons.
El middleware y la ruta rechazan peticiones sin credenciales; la ruta lo hace
antes de registrar la corrida. `config/external-crons.json` declara el horario.
La tira de salud de Kairo avisa si este proceso se atrasa o falla.

## Datos y verificación

Migración: `20261025170845_woocommerce_kenku_italia.sql`, aplicada en kairo-ai.
Tablas woo_orders / woo_order_events con RLS y acceso exclusivo service_role.
Funciones SECURITY INVOKER, search_path vacío y EXECUTE revocado a clientes.
La tienda kenku-it se activó en stores. No se importó histórico como pedido nuevo.

Pruebas automatizadas: firma/cuerpo/origen, rechazo antes de escritura,
duplicados, autorización por tienda, timeouts, recepción persistente,
reintento y worker autenticado. `tests/woo-database.sql` se ejecuta con
service_role dentro de BEGIN/ROLLBACK y verifica locks, revisión, auditoría,
leases y aislamiento. Ejecutar `npm test`, `npm run lint` y `npm run build`.

Pendiente independiente: puente Icomfly → WooCommerce, carga de históricos en WooCommerce y
validación comercial/legal de lanzamiento. Esta integración no despacha
paquetes ni envía mensajes a clientes.

## Gestión Shopify durante la migración (25-10-2026)

El dueño confirmó que la gestión se guarda en Kairo y Shopify conserva sus
estados originales. `/admin/finance/italia` ahora consulta ambos orígenes:
Shopify desde el respaldo existente (6.264 pedidos verificados) y WooCommerce
desde su tabla de recepción. No crea copias de pedidos Shopify en WooCommerce.
Las claves compuestas origen/ID impiden mezclar plataformas. El listado pagina
50 por petición, con búsqueda por pedido/cliente/teléfono y filtros por origen
y estado. El cron de respaldo sigue incorporando cambios cada cinco minutos.

En Shopify, **Gestionar** guarda estado operativo, nota interna, courier y guía.
Un historial registra actor, fecha, versión y valores antes/después. No llama
a la API de escritura Shopify, ni cobra, reembolsa, despacha o envía mensajes.
Los estados nativos de pago y preparación se muestran por separado: paid no
significa entregado; fulfilled es despachado salvo evidencia de entrega en
sus fulfillments. Cancelación/reembolso nativos prevalecen en la vista y
bloquean transiciones incompatibles, conservando la auditoría local.
Una edición de nota sin cambio de estado sigue usando el estado nativo.
WooCommerce conserva sus botones y retorno de estados ya implementados.

Migraciones aplicadas:
- `20261025183359_kenku_italia_shopify_management.sql`: gestión, auditoría,
  función transaccional y vista unificada SECURITY INVOKER.
- `20261025184034_kenku_italia_order_index.sql`: proyección de lectura pequeña,
  actualizada por trigger de cada alta/cambio de pedido en el respaldo. El
  payload original permanece intacto. La consulta principal se midió en
  17,8 ms frente a 904 ms sin proyección (medición puntual, no SLA).

Las tablas nuevas tienen RLS y acceso exclusivamente service_role; la vista
y funciones revocan acceso de anon/authenticated/PUBLIC. Las rutas exigen
operador de Italia y Origin válido para cambios. La versión del registro y
fecha de actualización Shopify evitan guardar sobre datos desactualizados.
Repetir el UUID de una petición idéntica no duplica la auditoría; reutilizarlo
con valores diferentes produce conflicto.

Validación: 1.266 tests y build/typecheck/lint correctos. SQL transaccional con
ROLLBACK verifica permisos, versiones, idempotencia, estados, preservación del
respaldo y refresco del índice. Playwright con registros sintéticos verifica
paginación del histórico real en lectura, filtros, búsquedas, permisos por
tienda, CSRF, gestión, historial, conflicto concurrente, conservación de notas
ante actualización del respaldo y botones WooCommerce. Los fixtures se borran
y las sesiones técnicas se invalidan al terminar. No se modifican pedidos
reales para las pruebas. Tiempo no cronometrado.

## Preparación de Stripe y Elogy (25-10-2026)

A petición del dueño, el receptor admite COD en cod-pending y Stripe pagado en processing, con paid=true, fecha de pago válida y transaction_id presente. Las firmas, país IT, EUR, CAP, origen e idempotencia mantienen sus controles. El JSON normalizado guarda método/indicador/fecha de pago sin conservar el identificador de transacción. El estado operativo sigue pending por el default transaccional existente; no se cambia la base de datos ni sus permisos.

Gestión identifica «Pagado con Stripe · No cobrar al entregar». Los COD anteriores conservan «Contra entrega · Cobrar al entregar». La confirmación se realiza por el flujo operativo normal y la cola de estados devuelve revisión 1 a WooCommerce; cod-core admite processing→processing solo para esta primera confirmación de un prepago real (método no COD, pagado y con transacción). WooCommerce registra _cod_core_crm_confirmed_at separado del estado de pago, útil para la futura selección Elogy. No implica que el conector Elogy soporte todavía ese filtro ni que esté conectado.

La cuenta Stripe debe conectarse y probarse en modo test (aprobado, rechazo, 3DS, reintentos/webhook). El cliente no debe ser cobrado otra vez al entregar y el estado processing por sí solo no autoriza a Elogy a despachar. No se ejecutaron cargos reales. La prueba de pago del gateway requiere las credenciales de Stripe del dueño. Verificación final y commit de producción se agregan al cierre. Responsable Codex, tiempo no cronometrado.

## Gestión de Italia con presentación común (25-10-2026)

Se reemplaza la lista de tarjetas por la presentación compacta de Gestión usada
en Honduras y Costa Rica: cabecera y selector de tienda, resumen operativo,
filtros por fecha de creación, búsqueda, contadores de estado y tabla paginada.
El número de pedido despliega dirección, CAP, productos, notas y seguimiento.
Se mantienen los formularios de gestión Shopify y las confirmaciones WooCommerce
con sus revisiones, UUID y controles de concurrencia. No cambian los pedidos
originales de Shopify ni se activa sincronización logística nueva.

Los contadores se consultan en el servidor con HEAD/count exact sobre la vista
privada existente, con el mismo origen, búsqueda y fechas que la lista; el estado
seleccionado filtra solo las filas. No se descargan todos los payloads para sumar.
Se reutilizan los contadores al paginar o cambiar de estado y se refrescan tras
una gestión, actualización manual o lectura periódica. No hay cambios de esquema.
Los días y rangos inclusivos se convierten a intervalos UTC semiabiertos según
Europe/Rome; las pruebas cubren días de 23 y 25 horas. Los errores de lectura se
informan y deshabilitan acciones sobre filas anteriores.

Esta entrega unifica la presentación de pedidos; liquidaciones, rentabilidad,
reportes y herramientas específicas de los couriers de HN/CR siguen requiriendo
sus fuentes e integraciones italianas. No se agregan pestañas sin funcionalidad.

Verificación: 1.289 tests, TypeScript, lint y build correctos. Lectura real sin
escrituras: 6.264 pedidos y suma de contadores consistente con la lista. La QA de
navegador usa respuestas simuladas para gestionar, sin insertar ni modificar
pedidos reales, sin cargos y sin envíos a Elogy. Evidencias locales en
output/playwright/kenkuit/italia-tabla-*. Responsable Codex, tiempo no cronometrado.

### Elogy: logística y finanzas (25–26 octubre)

Clave Rest API validada y secreto sensible configurado en producción. Espejo
privado inicial: 4.699 pedidos, 4.634 envíos únicos, 2.537 cobros del courier y
4.634 cargos company. Todos los envíos coinciden por referencia con Kairo.
Se agregan Logística Elogy, Liquidaciones, Rentabilidad, Costos por SKU, Gastos
y consulta de Cierre mensual, manteniendo la tabla operativa existente.

Remesas y abonos bancarios se registran por comprobante; COD del courier no
equivale a dinero recibido en banco. Faltan costos de compra de 22 SKU,
comisiones reales online y cierre de inventario de retornos para un resultado
operativo completo. No se alteran pedidos Shopify ni se despacha en Elogy.
Actualización reanudable por worker del VPS programado cada cinco minutos.
Contrato, permisos, contabilidad, pruebas y límites en
[Integración Elogy](elogy-italia-integracion.md). Responsable Codex, tiempo no cronometrado.
