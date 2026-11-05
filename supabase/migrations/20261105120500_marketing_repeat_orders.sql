-- Recompras por día para el simulador "Camino a 200" (05/11/2026, módulo 10).
--
-- Un pedido es recompra cuando el mismo teléfono (últimos 8 dígitos del
-- teléfono de envío) ya tenía un pedido no anulado al menos p_min_days días
-- antes. Solo salen conteos por día de Costa Rica: ningún teléfono, nombre ni
-- pedido sale de la función.
--
-- No sabe si la recompra vino de un mensaje de WhatsApp: iComfly no marca eso.

create or replace function public.marketing_repeat_orders(
  p_store bigint,
  p_from timestamptz,
  p_to timestamptz,
  p_min_days integer default 7
) returns table(day date, orders integer, repeat_orders integer)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      right(regexp_replace(coalesce(p.payload->>'shipping_phone', ''), '\D', '', 'g'), 8) as phone,
      (p.payload->>'created_at')::timestamptz as created,
      -- Estado de hoy en iComfly, como Gestión (lib/icomfly-estado-venta.ts):
      -- un Confirmada, Entregado o Devolucion con cancelled_at no es anulado;
      -- Testeos y Producto Agotado no cuentan como pedido (quedan fuera, como
      -- los anulados). cancelled_at solo decide sin estado o en gestión.
      case
        when s.status in (
          'cancelado', 'cancelada', 'anulado', 'anulada',
          'testeos', 'testeo', 'producto_agotado'
        ) then true
        when s.status in (
          'confirmada', 'confirmado', 'enviada', 'enviado', 'guia_generada',
          'en_transito', 'en_reparto', 'entregado', 'entregada', 'novedad',
          'novedad_operativa', 'devolucion', 'devuelto', 'devuelta',
          'reclame_oficina', 'pedido_pagado'
        ) then false
        else nullif(p.payload->>'cancelled_at', '') is not null
      end as cancelled
    from public.icomfly_order_payloads p
    cross join lateral (
      select regexp_replace(
        lower(btrim(translate(coalesce(p.payload->>'status', ''), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou'))),
        '[\s-]+', '_', 'g'
      ) as status
    ) s
    where p.store_id = p_store
      and nullif(p.payload->>'created_at', '') is not null
  ),
  valid as (
    select phone, created, cancelled from base where length(phone) = 8
  ),
  first_ok as (
    select phone, min(created) as first_created
      from valid
     where not cancelled
     group by phone
  )
  select
    (v.created at time zone 'America/Costa_Rica')::date as day,
    count(*)::integer as orders,
    (count(*) filter (
      where f.first_created <= v.created - make_interval(days => greatest(p_min_days, 0))
    ))::integer as repeat_orders
  from valid v
  left join first_ok f on f.phone = v.phone
  where v.created >= p_from and v.created < p_to and not v.cancelled
  group by 1
  order by 1;
$$;

revoke all on function public.marketing_repeat_orders(bigint, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.marketing_repeat_orders(bigint, timestamptz, timestamptz, integer) to service_role;

comment on function public.marketing_repeat_orders(bigint, timestamptz, timestamptz, integer) is 'Pedidos no anulados por día de Costa Rica y cuántos son de un teléfono que ya había comprado (pedido no anulado) al menos p_min_days días antes. Solo conteos. Solo service role.';
