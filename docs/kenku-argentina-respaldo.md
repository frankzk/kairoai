# Respaldo independiente de Kenku Argentina

El dueño solicitó extraer todos los datos disponibles antes de perder conexión
con Shopify, auditar el histórico y ordenar el catálogo para usarlo sin Shopify.
Los pedidos y los datos originales se conservan; no se crean ventas, cargos,
mensajes, despachos ni cambios de catálogo en Shopify.

El respaldo existente guarda 20 categorías de datos y fotos en almacenamiento
privado. La extracción adicional contrasta conteos y permisos, vuelve a recorrer
los recursos desde el inicio sin ventana de fechas y captura temas/archivos,
metadatos, navegación y exportaciones masivas de lectura cuando la app lo permite.
Un recurso denegado queda registrado como error, nunca como respaldo completo.

`POST /api/argentina/backup` exige ARGENTINA_BACKUP_SECRET, solo de servidor,
antes de analizar la petición. Recibe operaciones permitidas por nombre, nunca
URLs, credenciales o consultas arbitrarias. La clave está en Vercel Production
y en un archivo privado ignorado. La ruta no devuelve pedidos/clientes; solo
estado de ejecución y conteos. Un lease transaccional limita la concurrencia.
Se usa Shopify Admin API 2026-10, sin seguir redirecciones con el token.

Las tablas argentina_shopify_extra / argentina_shopify_extra_state y el bucket
argentina-shopify-archive son privados. RLS está activada y los clientes no
tienen permisos; solo service_role puede leer/escribir. Los resultados masivos
se validan como JSONL y se contrastan con objectCount antes de marcarlos completos.

Ejecución manual: `node scripts/argentina-backup-run.cjs audit` y luego `all`.
No se instala una automatización nueva. El cron anterior conserva su actualización.
El worker guarda sus resultados técnicos en archivos .env.argentina-backup-*.
La clave y estos archivos no se versionan.

`scripts/argentina-backup-snapshot.cjs <directorio>` exporta las filas completas
en JSONL gzip, con conteos comprobados, fotos descargadas y manifiesto SHA-256.
La copia privada de este trabajo está en
`C:\Users\Pc\Documents\Kairo\backups\kenku-argentina\2026-10-26`.
La carpeta backups está excluida de Git; no se adjunta a PRs ni se publica.

El estado de un recurso completo significa que terminó la paginación accesible,
no que Shopify concedió todos los permisos ni que el conjunto incluye datos de
apps externas. read_all_orders debe comprobarse para acreditar pedidos antiguos.
Temas Liquid requieren adaptación a la plataforma futura; guardar el código no
equivale a disponer de un checkout WooCommerce. Las contraseñas de clientes y
datos de tarjetas no se exportan desde Shopify.

La auditoría final, los límites observados y la prueba offline se registrarán
al concluir la extracción. DropLatam/Fixy siguen fuera de este trabajo.

Clientes y catálogo se consultan en `/admin/finance/argentina/customers` y
`/admin/finance/argentina/catalog`. Sus APIs leen únicamente el archivo de Kairo;
las imágenes usan copias privadas propias. Ambas rutas exigen acceso a Argentina.
Los códigos internos conservan el SKU original si es único; para SKU faltantes
o repetidos usan KAR-V seguido del ID de variante. No se escribe en Shopify.

Prueba de navegador: con las solicitudes a Shopify bloqueadas, se verificaron
8.491 clientes, paginación, búsqueda vacía, 16 productos y sus 16 imágenes,
16 códigos internos únicos, vista móvil y regresión del catálogo de México.
La auditoría detectó 4 variantes sin SKU original y 2 con SKU original repetido.

Al 26/10/2026 se contrastaron 6.689 pedidos, 8.491 clientes, 16 productos y
7.776 borradores: los cuatro conteos coinciden con Shopify. read_all_orders
está concedido en Kairo Kenku ARG (439649239041); el pedido más antiguo es del
02/10/2025. Se recuperaron los 6.027 pedidos que faltaban. Búsqueda y paginación
del histórico se verificaron con las solicitudes a Shopify bloqueadas.

Se conservaron 1.013 archivos de tres temas y cinco exportaciones adicionales,
incluidos 21.546 registros de preparación de pedidos y sus líneas. Los enlaces
temporales de archivos se descargan durante la extracción y se verifica su MD5.
La copia portable mantiene ambos originales de Shopify cuando el JSON cambia
de formato; una excepción de checksum de bytes se acredita por igualdad de los
valores JSON entre REST y GraphQL y se declara en auditoria.json. No se presenta
esa excepción como coincidencia de checksum.

La auditoría conserva una referencia de borrador cuyo pedido devuelve 404 y una
línea histórica cuya variante ya no aparece en el catálogo actual. No se crean
pedidos ni productos para ocultar esas diferencias. Markets y las liquidaciones
de Shopify Payments devolvieron denegación de acceso y quedan identificados como
no exportados; DropLatam/Fixy siguen pendientes. Las referencias CDN inexistentes
quedan en asset-errors.json. Los JSON originales, CSV, SQLite, archivos y hashes
de integridad permanecen en la carpeta privada de respaldo.
