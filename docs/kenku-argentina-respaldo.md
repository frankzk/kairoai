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
