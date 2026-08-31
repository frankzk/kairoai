-- Los contadores tienen que ver lo mismo que la lista.
--
-- 0033 dejo anotado que si `sinceFilter` y este RPC se separan, los contadores
-- dejan de sumar lo que el tablero muestra. Eso es justo lo que iba a pasar:
-- `sinceFilter` ahora exime de la ventana de 30 dias a los estados de pago por
-- verificar, y sin este cambio el RPC seguiria descartandolos.
--
-- POR QUE UN PARAMETRO Y NO UN `status in ('sinpe_por_verificar')` AQUI: el
-- catalogo de estados vive en lib/leads-classify.ts. Escribir el codigo del
-- estado en SQL seria una segunda fuente de verdad — el mismo motivo por el que
-- 0033 devuelve las tuplas sin clasificar. El que llama pasa la lista que sale
-- de `statusesForBoard("pago_verificar")`.
--
-- OJO CON LA SOBRECARGA: agregar un parametro NO reemplaza la funcion de 0033,
-- crea una segunda. Con las dos vivas y `p_always_statuses` teniendo default,
-- una llamada de dos argumentos encaja en ambas y PostgREST responde "could not
-- choose the best candidate function" — o sea, el tablero entero en 500. Por eso
-- se borra la vieja explicitamente.
drop function if exists leads_stage_tuples(bigint, timestamptz);

create or replace function leads_stage_tuples(
  p_store_id bigint,
  p_since timestamptz default null,
  p_always_statuses text[] default '{}'
)
returns table (
  status text,
  status_source text,
  shopify_cart_open boolean,
  has_order boolean,
  n int
)
language sql
stable
as $$
  select l.status, l.status_source, l.shopify_cart_open, l.has_order, count(*)::int
  from leads l
  where l.store_id = p_store_id
    -- Mismo corte que `sinceFilter` en lib/leads.ts, condicion por condicion.
    and (
      p_since is null
      or l.last_interaction_at >= p_since
      or l.next_followup_at is not null
      or l.needs_attention is true
      or l.status = any (p_always_statuses)
    )
  group by l.status, l.status_source, l.shopify_cart_open, l.has_order;
$$;
