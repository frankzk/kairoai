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

1.368 pruebas, TypeScript, lint y build correctos. Pruebas de lectores verifican
tienda impuesta en servidor, búsqueda escapada, precios decimales, ausencia de
datos privados innecesarios y cero llamadas a Shopify. El lease se prueba con
BEGIN/ROLLBACK. QA local y evidencia de extracción se amplían durante la tarea.
