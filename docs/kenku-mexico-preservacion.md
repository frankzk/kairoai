# Preservación de Kenku México

Solicitud del dueño, 26-10-2026: extraer lo que falta mientras Shopify responde
y comprobar uso independiente de pedidos, clientes y productos.

## Lectores independientes

Gestión México incorpora Clientes y Catálogo. Las APIs `/api/mexico/customers`
y `/api/mexico/catalog` leen únicamente la base de Kairo. Las fotos se firman
desde la copia privada de Storage; no hay fallback al CDN de Shopify. Precios
como cadenas decimales, CP y SKU se conservan. Son vistas del respaldo, con
búsqueda, paginación y detalle; no editan el original comercial.

## Extracción ampliada

`POST /api/mexico/preservation` ejecuta planes de lectura predefinidos, guardados
por service_role en `shopify_preservation_records`. El cliente solo selecciona
un nombre de recurso, nunca envía queries, URLs ni credenciales. Requiere
permiso config y acceso a México, sesión válida y Origin propio. Los secretos
Shopify permanecen en Vercel. La API de Shopify usada es 2026-10.

Los planes de `scripts/kenku-mx-preservation-plans.cjs` cubren datos financieros,
historial y metacampos, preparación logística, clientes, catálogo ampliado,
costos e inventario, archivos, temas, navegación, definiciones, traducciones y
otros recursos disponibles según los permisos reales de la app.

Las exportaciones masivas son consultas; la única mutación Shopify crea el
trabajo de exportación. No crea ni cambia ventas, cobros, pedidos o catálogo.
El trabajo guarda ID, estado, conteos y progreso. Sus archivos JSONL se copian
en partes al bucket privado shopify-preservation con tamaño, líneas y SHA-256.
La finalización exige que el número de líneas coincida con objectCount.
Un trabajo fallido no se presenta como completo. Las URLs temporales de Shopify
no son la copia de respaldo; al completar la copia se retiran del estado.

Los extractores normales paginan hasta terminar y rechazan colecciones anidadas
truncadas. Las lecturas REST de configuración rechazan paginación sin procesar.
Un lease transaccional evita dos ejecuciones simultáneas del mismo recurso.
Errores y denegaciones se conservan para el informe de cobertura.

## Seguridad y validación

Migración `20261026210611_kenku_mexico_preservation.sql` aplicada en kairo-ai.
Tabla con RLS, sin acceso de anon/authenticated; vistas SECURITY INVOKER y
función de lease SECURITY INVOKER con search_path vacío. Bucket nuevo privado,
sin políticas que concedan acceso a clientes. No cambia otras tiendas.

Pruebas de lectores verifican
tienda impuesta en servidor, búsqueda escapada, precios decimales, ausencia de
datos privados innecesarios y cero llamadas a Shopify. El lease se prueba con
BEGIN/ROLLBACK.

## Copia portable y restauración

`node scripts/kenku-mx-export.cjs base <directorio>` descarga los JSON originales
y las imágenes del bucket privado. `extras` copia los registros adicionales,
verifica SHA-256 de los archivos masivos y descarga medios de los hosts de
Shopify permitidos. `customers` actualiza solamente esa colección; `viewer`
agrega el visor sin dependencias externas. Los comandos requieren credenciales
locales de servicio; nunca las escriben dentro del respaldo. El directorio debe
estar vacío o contener el marcador de un respaldo de México.

Con Python 3.10 o superior:

```
python scripts/kenku-mx-offline.py build <directorio>
python scripts/kenku-mx-offline.py seal <directorio>
python scripts/kenku-mx-offline.py verify <directorio>
python scripts/kenku-mx-offline.py serve <directorio>
```

El índice SQLite se reconstruye desde los JSONL. El visor enlaza clientes,
pedidos y datos adicionales por sus identificadores originales; conserva
decimales, códigos postales y SKU como texto. Solo escucha en 127.0.0.1 y su
CSP impide conexiones externas. No necesita Shopify, Supabase ni internet.
El manifiesto comprueba cada archivo por tamaño y SHA-256 y compara los
conteos del índice con la captura. No debe modificarse un paquete ya sellado.

La prueba de restauración extrae un ZIP en otro directorio, verifica sus hashes
y abre ese visor con todas las conexiones externas bloqueadas. La evidencia
privada se guarda fuera del paquete en `output/playwright/kenkumx/`.
El respaldo contiene datos personales; `output/backups/` está excluido de Git.

## Cobertura y límites visibles

La extracción conserva 24.120 pedidos, 23.593 clientes, 44 productos y 8.929
borradores, además de inventario, transacciones, cargos, historial, preparación
logística, archivos, cuatro temas y traducciones disponibles. Los trabajos y
sus conteos reales están en `snapshot.json`; no se interpreta una denegación
de permisos como colección vacía. Algunos recursos solo se pueden copiar
después de que el dueño publique y autorice nuevos permisos de la app.

Los originales de MediaImage usan URLs firmadas que caducan en cinco minutos:
se solicitan por páginas pequeñas y se descargan inmediatamente. Se guarda el
archivo, no solo su URL. Los JSON de temas pueden incluir un encabezado y
formato agregado por Shopify; su representación recibida y metadatos originales
se conservan, y las diferencias se registran aparte de archivos faltantes.
Los errores del CDN o recursos retirados quedan enumerados para no afirmar
una cobertura que la fuente no permite.

Los planes confiables pueden renovar la credencial mediante client credentials
en Vercel para recoger permisos recién autorizados, sin exponer secretos.
Una colección acotada por página debe declarar `boundedPage`; las demás
consultas se rechazan si una conexión anidada quedó truncada. Reintentar un
bulk fallido conserva su estado anterior en `_attempt`. El lease dura 600 s,
más que el límite de 300 s de la función, para impedir solapamientos.

El respaldo es una captura para consulta, exportación y migración. El checkout,
procesamiento de pagos y creación de nuevas ventas requieren implementar o
conectar esos servicios. Los envíos y liquidaciones propios de DropLatam
deben incorporarse desde ese operador para completar la operación.

## Ampliación autorizada del 27-10-2026

La credencial renovada confirma `read_discounts`, `read_markets`, `read_locales`
y `read_returns` en la misma app Kairo Kenku MX. Se extrajeron dos mercados con
sus condiciones de países, monedas, dominios, idioma e impuestos, español como
único idioma publicado y 470 definiciones de motivos de devolución. La consulta
de descuentos modernos finalizó sin registros. La exportación de devoluciones
nativas terminó con 24.120 pedidos y ningún nodo Return; los 5.913 reembolsos
guardados en el respaldo financiero son un recurso distinto.

Las reglas legales de devolución requieren `read_legal_policies`, que no está
concedido. Tarjetas regalo, scripts y liquidaciones de Shopify Payments siguen
denegados con una credencial renovada. Estos bloqueos se conservan en el informe;
no se interpretan como colecciones vacías. La copia del día 26 se conserva y la
ampliación se empaqueta como una versión nueva del día 27, con índice, manifiesto
y prueba de restauración propios. La autorización de México solicita los cuatro
permisos ya publicados; las otras tiendas mantienen sus alcances anteriores.
