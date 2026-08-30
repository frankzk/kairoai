-- Los contadores del tablero de leads, agregados en Postgres.
--
-- POR QUE: `countLeadStages` se bajaba UNA FILA POR LEAD solo para contarlas en
-- memoria. En Costa Rica son 6.212 filas elegibles, que PostgREST corta de a
-- 1.000, asi que eran SIETE viajes de ida y vuelta antes de poder pintar los
-- contadores. Medido en la base: el mismo conteo como agregado tarda 17 ms y
-- devuelve 55 filas. Los viajes son el costo, no el trabajo.
--
-- QUE DEVUELVE: las tuplas distintas de las cuatro columnas que deciden el
-- bucket, con su conteo. A proposito NO devuelve el bucket ya resuelto: el
-- mapeo status -> bucket vive en el catalogo de lib/leads-classify.ts y
-- duplicarlo aca en un CASE seria una segunda fuente de verdad que se
-- desincroniza en silencio la proxima vez que se agregue un estado. El servidor
-- agrupa; `leadBoardStage` sigue clasificando.
--
-- Va por RPC porque PostgREST no sabe hacer GROUP BY.
--
-- El techo de tuplas es el producto del catalogo: 31 estados x 2 origenes x 2
-- x 2 = 124. Hoy son 55 en Costa Rica y 41 en Honduras.
create or replace function leads_stage_tuples(
  p_store_id bigint,
  p_since timestamptz default null
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
    -- Mismo corte que `sinceFilter` en lib/leads.ts: esconde los muy antiguos
    -- PERO conserva los que tienen seguimiento agendado o estan marcados para
    -- atencion. Si los dos filtros se separan, los contadores dejan de sumar lo
    -- que muestra la lista.
    and (
      p_since is null
      or l.last_interaction_at >= p_since
      or l.next_followup_at is not null
      or l.needs_attention is true
    )
  group by l.status, l.status_source, l.shopify_cart_open, l.has_order;
$$;
