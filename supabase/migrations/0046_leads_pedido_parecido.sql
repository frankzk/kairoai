-- Leads que SI compraron, pero con un telefono casi igual al del carrito.
--
-- El cruce lead<->orden (0025/0030) une por telefono EXACTO. Cuando el cliente
-- escribe mal un digito en el formulario y despues compra con el numero bueno,
-- el carrito queda abierto para siempre: la asesora lo llama, el bot le sigue
-- escribiendo al numero equivocado (que es de otra persona) y el lead nunca
-- pasa a Ganados.
--
-- Medido en produccion el 14/10/2026, entre 279 carritos abiertos de los
-- ultimos 30 dias: 7 ya tenian pedido con un telefono que difiere en UN digito
-- (8606-3000 en el carrito, 8604-3000 en el pedido) y 1 con otro numero pero
-- el mismo nombre completo y el mismo producto.
--
-- Esta funcion SOLO PROPONE candidatos; no cambia nada. La decision (que el
-- nombre o el producto confirmen que es la misma persona, y que las fechas
-- calcen) vive en lib/leads-pedido-parecido.ts, que tiene sus tests.
--
--   via 'telefono': los ultimos 8 digitos difieren en exactamente una posicion.
--                   Se busca enmascarando cada posicion (8 variantes por
--                   telefono) y uniendo por igualdad: un hash join, sin comparar
--                   todos contra todos.
--   via 'nombre':   mismos dos primeros nombres (sin tildes, en minuscula) y
--                   telefono distinto.
--
-- Solo ordenes vigentes (no canceladas) y leads sin pedido que no esten en un
-- estado protegido (lista_negra, cancelado_cliente, cancelado: los mismos que
-- respeta el cruce exacto, ver PURCHASE_PROOF_STATUSES).

create or replace function public.kairo_nombre_clave(p_nombre text)
returns text
language sql
immutable
as $$
  -- "María  José Pérez" -> "maria jose". Null si no hay dos palabras de 3+
  -- letras distintas ("Carlos Carlos" no sirve para reconocer a nadie).
  with t as (
    select array(
      select w from regexp_split_to_table(
        trim(regexp_replace(lower(translate(coalesce(p_nombre, ''), 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouunn')), '[^a-z]+', ' ', 'g')),
        ' '
      ) w
      where length(w) >= 3
    ) as w
  )
  select case when cardinality(w) >= 2 and w[1] <> w[2] then w[1] || ' ' || w[2] end from t
$$;

create or replace function public.leads_order_candidates_near(p_store_id bigint, p_days integer default 45)
returns table (
  lead_id bigint,
  lead_phone text,
  lead_name text,
  lead_first_seen timestamptz,
  lead_cart_at timestamptz,
  lead_cart text,
  order_name text,
  order_phone text,
  order_customer text,
  order_created timestamptz,
  order_items text,
  via text
)
language sql
stable
as $$
  with l as (
    select id, phone, name, first_seen_at, shopify_draft_updated_at, cart_summary,
           right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) as k,
           public.kairo_nombre_clave(name) as nk
    from public.leads
    where store_id = p_store_id
      and not has_order
      and status not in ('lista_negra', 'cancelado_cliente', 'cancelado')
      and greatest(
            coalesce(first_seen_at, '-infinity'),
            coalesce(shopify_draft_updated_at, '-infinity'),
            coalesce(last_interaction_at, '-infinity')
          ) > now() - make_interval(days => p_days)
  ),
  o as (
    select name, phone, shopify_created_at, line_items,
           coalesce(nullif(trim(customer_name), ''), trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) as cliente,
           right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) as k
    from public.shopify_orders
    where store_id = p_store_id
      and cancelled_at is null
      and shopify_created_at > now() - make_interval(days => p_days + 3)
  ),
  lm as (
    select l.id, l.k, i, overlay(l.k placing '_' from i for 1) as mk
    from l cross join generate_series(1, 8) i
    where l.k ~ '^\d{8}$'
  ),
  om as (
    select o.name, o.k, i, overlay(o.k placing '_' from i for 1) as mk
    from o cross join generate_series(1, 8) i
    where o.k ~ '^\d{8}$'
  ),
  pares as (
    select lm.id as lead_id, om.name as order_name, 'telefono'::text as via
    from lm join om on om.i = lm.i and om.mk = lm.mk
    where om.k <> lm.k
    union
    select l.id, o.name, 'nombre'::text
    from l join o on public.kairo_nombre_clave(o.cliente) = l.nk
    where l.nk is not null and o.k is distinct from l.k
  )
  select l.id, l.phone, l.name, l.first_seen_at, l.shopify_draft_updated_at, l.cart_summary,
         o.name, o.phone, o.cliente, o.shopify_created_at,
         (select string_agg(x ->> 'title', ' + ')
            from jsonb_array_elements(case jsonb_typeof(o.line_items) when 'array' then o.line_items else '[]'::jsonb end) x),
         p.via
  from pares p
  join l on l.id = p.lead_id
  join o on o.name = p.order_name
$$;

NOTIFY pgrst, 'reload schema';
