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

Pendiente independiente: puente Icomfly → WooCommerce, carga de históricos y
validación comercial/legal de lanzamiento. Esta integración no despacha
paquetes ni envía mensajes a clientes.
