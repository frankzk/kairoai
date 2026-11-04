# Recuperación de atribución de pedidos — Mireva Costa Rica

Corte de auditoría: 4 de noviembre de 2026. Cohortes por creación del pedido en America/Costa_Rica; cada compra canónica se cuenta una vez.

| Cohorte | Pedidos | Campaña identificada antes | Campaña identificada después | Cobertura después |
| --- | ---: | ---: | ---: | ---: |
| Octubre | 3.473 | 1.428 (41,1%) | 1.664 | 47,9% |
| Noviembre, 1–4 | 375 | 131 (34,9%) | 139 | 37,1% |

La recuperación agrega 236 pedidos de octubre y 8 de noviembre. Los datos de noviembre seguirán cambiando al sincronizar pedidos nuevos. No se detectaron contradicciones de ID ni atribuciones ambiguas en este corte.

## Por qué faltaba atribución

El 41,1% medía pedidos con plataforma y campaña identificables, no cualquier presencia de UTM. La consulta leía únicamente ad_origin de iComfly. Había otros datos válidos conservados en Shopify que no se incorporaban; diferencias de codificación hacían parecer incompatibles UTM que identificaban la misma campaña. Además, algunos pedidos tenían ID válido pero utm_source no identificaba la plataforma. Los reemplazos de upsell perdían el origen del pedido inicial.

## Fuentes y reglas de recuperación

- ad_origin de los payloads guardados de iComfly.
- note_attributes de shopify_orders y del respaldo shopify_archivo, únicamente recurso order y la tienda correcta. No se extraen campañas desde notas libres.
- Catálogo de ID de campaña y cuenta leídos de las fuentes publicitarias autenticadas de Marketing. Un origen desconocido solo se resuelve si su ID coincide de forma única; nunca por nombre de producto o campaña.
- Relaciones explícitas y completadas de order_upsell_replacements, incluyendo reemplazos sucesivos. Se conserva la procedencia; no se modifican los pedidos externos.
- Cruce con el pedido canónico por referencia exacta o guía única, sin coincidencias por teléfono o cliente. Campos compatibles se complementan y cada compra se cuenta una sola vez. IDs contradictorios se excluyen.

La recuperación se calcula al leer Marketing y la ficha de pedido; no sobrescribe el respaldo ni el ad_origin original. El catálogo es una caché privada de metadatos publicitarios, sin clientes ni códigos de clic.

## Qué sigue faltando

En octubre quedan 1.809 pedidos sin campaña identificable: 1.730 sin origen registrado y 79 con información parcial. Algunos pedidos guardan solo códigos opacos de clic (ttclid/fbclid): esos valores no prueban por sí solos un ID de campaña o anuncio. No se clasifican como orgánicos ni se reparte su entrega proporcionalmente entre campañas.

Shopify actualmente rechaza la sincronización de pedidos con HTTP 403, Unavailable Shop. La recuperación utiliza lo que Kairo conservó antes de perder acceso; no depende de que Shopify vuelva a responder.

Empezar en noviembre no elimina el problema: la cobertura recuperada del corte es 37,1%. Se debe mejorar la captura de UTM al entrar a la tienda y conservarlos hasta el pedido; la recuperación explícita de upsells ya cubre esa pérdida dentro de Kairo. Cambiar anuncios o la tienda externa no forma parte de esta corrección.

## Efecto en el costo por entregado

En octubre las entregas vinculadas a campañas pasan de 517 a 643: 126 entregas adicionales para el denominador. Marketing recalcula el costo como inversión de la campaña en el período dividida entre entregas identificadas de la misma cohorte. Los pendientes y anulados no se suman al denominador de entregas; la efectividad sobre cerrados usa entregados / (entregados + no entregados o devueltos).

Mientras falten entregas por atribuir, este costo puede estar sobreestimado y debe seguir etiquetado como costo sobre entregas identificadas. No es un costo definitivo de todas las entregas. Los rankings anteriores con 41,1% de cobertura deben recalcularse con la recuperación.

## Validación

La auditoría usa el mismo ensamblador de compras canónicas que Finanzas y contrasta los ID con las fuentes publicitarias. La prueba de cadena de upsell IC-W468 → IC-W474 → IC-W572 recuperó la campaña original sin consultar ni modificar datos del cliente. Las pruebas automatizadas cubren aislamiento por tienda, paginación, privacidad, codificación, conflictos, duplicados y escrituras concurrentes del catálogo.
