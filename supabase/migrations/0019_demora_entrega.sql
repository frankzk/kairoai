-- Nueva causa de novedad: 'demora_entrega'.
--
-- POR QUE EXISTE: hasta ahora una novedad solo nacia cuando el courier reportaba
-- una FALLA (grupo "failed"). Un envio que se queda "en curso" para siempre
-- —recolectado, en ruta, reintento— nunca falla, asi que no entraba a la bandeja
-- y nadie lo perseguia: quedaba invisible entre los pedidos "en progreso".
--
-- Medido el 15/09 en Mireva Costa Rica: 417 envios con guia ni entregados ni
-- devueltos, de los cuales 46 llevaban mas de 14 dias desde el pedido y 13 mas
-- de 30 (el peor, 111 dias sin un solo evento nuevo del courier). Pedidos de
-- julio seguian figurando como "En ruta" en septiembre.
--
-- La deteccion ahora los da de alta con esta causa cuando pasan el umbral
-- (ver DEMORA_DIAS_DESDE_PEDIDO / DEMORA_DIAS_SIN_MOVIMIENTO en
-- lib/incidents-detect.ts). Solo se agrega el valor al CHECK; ninguna fila
-- existente cambia.
ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_category_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_category_check CHECK (category IN (
  'fallo_entrega','direccion_incorrecta','cliente_no_responde',
  'cliente_rechaza','devuelto_origen','dano_paquete','demora_entrega','otro'));
