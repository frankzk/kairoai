# Integración Elogy para Gestión de Italia

## Acceso confirmado por el dueño

La captura del 25-10-2026 muestra `My company → API & Notifications → Rest API`,
con una clave de autenticación ya existente. No se necesita crear otra clave ni
usar la contraseña de la cuenta para leer la API. La captura está parcialmente
tapada y no permite utilizar su valor completo.

El archivo local `.env.elogy-api-kenku-it`, en el directorio privado de Kairo,
recibe `ELOGY_KENKU_IT_API_KEY`. Está ignorado por Git y su ACL permite acceso
solo al usuario actual. No publicar la clave en el chat, logs, errores, archivos
versionados ni variables `NEXT_PUBLIC_`. Falta que el dueño guarde su valor.

La clave WooCommerce `Elogy - Kenku Italia` es independiente: permite que Elogy
consulte la tienda; no permite que Kairo consulte Elogy.

## Contrato público consultado

Fuente oficial enlazada por el sitio de Elogy:
https://documenter.getpostman.com/view/198132/TVRq36Yh

Host: `https://api.elogy.io`. La colección documenta el encabezado
`Authorization` y los siguientes GET:

| Recurso | Ruta |
| --- | --- |
| Pedidos | `/api/orders` |
| Envíos | `/api/shipped` |
| Contra entrega | `/api/shippedCod` |
| Devoluciones | `/api/returnsV2` |
| Facturación | `/api/companyBillings` |
| Historial de seguimiento | `/api/order/:order_number/historyTracking` |

La colección no incluye ejemplos de respuesta de envíos, COD ni facturación.
No asumir que la facturación representa transferencias COD al comercio. Antes
de persistir esos datos, verificar campos, unidades monetarias, fechas,
identificadores, paginación y alcance de la cuenta con peticiones de solo lectura.

## Base implementada

`lib/elogy.ts` incluye cliente GET de host fijo, timeout, rechazo de redirecciones,
errores técnicos sin cuerpos privados y validación del sobre documentado. La
paginación avanza por filas recibidas; una página corta no se considera final
sin el total o una página vacía. También incluye importes en céntimos que
conservan la diferencia entre cero y dato ausente, referencias exactas de pedido,
clasificación explícita de estados italianos y limpieza de credenciales anidadas.

Ocho pruebas aisladas cubren estas propiedades. No hay llamadas a la cuenta de
Elogy, modificación de configuración, sincronizaciones ni migraciones aplicadas.
No se ha desplegado todavía esta integración.

## Trabajo posterior a validar la clave

1. Leer una página de pedidos, envíos, COD y facturación; guardar solo evidencia
   técnica y esquemas sin secretos ni datos personales innecesarios.
2. Identificar cómo se distinguen entrega, cobro del courier, remesa de Elogy y
   recepción bancaria. No tratar `Delivered COD` como dinero recibido.
3. Diseñar persistencia idempotente y conciliación por identificador/guía y
   referencia exacta, con conflictos visibles para cruces ambiguos.
4. Costos por SKU y fecha, incluidos regalos; gastos EUR y comisiones reales.
   Mantener importes desconocidos como pendientes, no como cero.
5. Añadir logística, liquidaciones, rentabilidad y cierre mensual con permisos
   separados de operación y finanzas. Conservar el estado original de Shopify y
   evitar un ciclo de estados entre WooCommerce, Kairo y Elogy.
6. Probar importación tardía, duplicados, devoluciones, Stripe sin COD, datos
   incompletos, acceso por tienda y conciliación con el informe de Elogy.

Las exportaciones históricas de envíos localizadas en Descargas tienen campos
de referencia, guía, courier, pago y seguimiento. No contienen importes de
liquidación. No se importaron a Kairo ni se reenviaron como pedidos nuevos.
