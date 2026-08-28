-- Busqueda tolerante de telefonos en el tablero de leads.
--
-- POR QUE: los celulares de CR/HN son de 8 digitos y la busqueda exacta hace
-- `phone ilike %digitos%`. Un solo digito de mas o de menos da CERO resultados
-- y ninguna pista, asi que la asesora da por perdido un lead que si existe.
-- Caso real: se busco 5068428896 y el lead estaba guardado como 50684288896
-- (faltaba un 8) -- "0 resultados en todas las etapas".
--
-- Con trigramas el correcto sale con similitud 0.917 y el siguiente candidato
-- queda en 0.533, asi que se separa limpio del ruido.
--
-- pg_trgm ya viene habilitado desde 0024_finance_order_index.sql.
create index if not exists leads_phone_trgm_idx
  on leads using gin (phone gin_trgm_ops);

-- Va por RPC porque PostgREST no puede ordenar por similarity() ni usarla como
-- filtro. Devuelve el lead completo para que el tablero lo pinte igual que un
-- resultado normal.
--
-- El umbral 0.45 sale de medir el caso real: el correcto dio 0.917 y el
-- siguiente 0.533. Se deja por debajo de ese 0.533 para que un error de DOS
-- digitos tambien encuentre algo, y se corta por `p_limit` para que la lista
-- no se vuelva ruido.
create or replace function leads_phone_similar(
  p_store_id bigint,
  p_phone text,
  p_limit int default 8
)
returns setof leads
language sql
stable
as $$
  select l.*
  from leads l
  where l.store_id = p_store_id
    and similarity(l.phone, p_phone) > 0.45
  order by similarity(l.phone, p_phone) desc, l.last_interaction_at desc nulls last
  limit greatest(p_limit, 0);
$$;
