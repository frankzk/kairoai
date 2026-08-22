-- Match manual de liquidaciones (0025).
--
-- Algunas filas de liquidación llegan identificadas con un token de checkout
-- (ej. "SHOP-MRTW7QBC-FABV") en vez del número de pedido #MCRC, y el pedido de
-- Shopify no trae ese token en ninguna parte (ni nota, ni tracking, ni raw).
-- El emparejamiento automático (por #MCRC / número / código numérico de nota)
-- no tiene forma de cruzarlas. Este flag permite fijar el vínculo A MANO desde
-- el tab Liquidaciones y que PERSISTA: el "Re-emparejar" y la re-importación
-- respetan las filas con manual_match = true (no las vuelven a "sin match").
ALTER TABLE settlement_rows
  ADD COLUMN IF NOT EXISTS manual_match boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
