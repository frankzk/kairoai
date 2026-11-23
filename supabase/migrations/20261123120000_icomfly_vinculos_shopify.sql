-- Vínculos Shopify ↔ iComfly que iComfly no guardó (23/11/2026).
--
-- En agosto y septiembre iComfly no guardó el número de Shopify en muchos
-- pedidos, así que Kairo no veía qué pasó con ellos: 86 pedidos de Shopify sin
-- guía ni anulación quedaban en Pendientes aunque en iComfly estuvieran en
-- Testeos, cancelados o en otra gestión. El cruce por teléfono y hora de
-- creación es exacto (mismo pedido creado a la vez en los dos lados: menos de
-- 4 segundos de diferencia en los 84 que cruzan, y ninguno ambiguo).
--
-- El vínculo vive en su propia tabla y no en icomfly_orders, porque la
-- sincronización de iComfly reescribe shopify_display_number en cada corrida.
-- listIcomflyOrders (lib/finance.ts) completa el número desde aquí cuando
-- iComfly lo trae vacío.
--
-- Solo service role (RLS activa sin políticas). Re-ejecutable.

create table if not exists public.icomfly_vinculos_shopify (
  store_id          int  not null,
  icomfly_order_id  text not null,
  shopify_name      text not null,
  metodo            text not null default 'telefono_hora',
  creado_at         timestamptz not null default now(),
  primary key (store_id, icomfly_order_id)
);
create unique index if not exists icomfly_vinculos_shopify_nombre
  on public.icomfly_vinculos_shopify (store_id, shopify_name);
alter table public.icomfly_vinculos_shopify enable row level security;

-- Pedidos de Shopify de Costa Rica (store 1) desde agosto, sin guía ni
-- anulación, cuyo número no está en iComfly; se vinculan con el pedido de
-- iComfly sin número de Shopify que tiene el mismo teléfono (8 últimos
-- dígitos) y se creó a menos de 10 minutos. Solo los cruces únicos en los dos
-- sentidos.
with icn as (
  select distinct upper(regexp_replace(shopify_display_number, '[^A-Za-z0-9]', '', 'g')) k
    from icomfly_orders
   where store_id = 1 and coalesce(shopify_display_number, '') <> ''
), so as (
  select s.name, s.shopify_created_at c,
         right(regexp_replace(coalesce(s.phone, s.raw_order->'shipping_address'->>'phone',
               s.raw_order->'customer'->>'phone', ''), '\D', '', 'g'), 8) ph
    from shopify_orders s
   where s.store_id = 1 and s.cancelled_at is null and coalesce(s.tracking_number, '') = ''
     and s.shopify_created_at >= '2026-08-01T06:00:00Z'
     and not exists (select 1 from icn where icn.k = upper(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g')))
), ic as (
  select o.icomfly_order_id id, o.icomfly_created_at c,
         right(regexp_replace(coalesce(p.payload->'customer'->>'phone', p.payload->>'shipping_phone', ''),
               '\D', '', 'g'), 8) ph
    from icomfly_orders o
    join icomfly_order_payloads p on p.store_id = o.store_id and p.icomfly_order_id = o.icomfly_order_id
   where o.store_id = 1 and coalesce(o.shopify_display_number, '') = ''
     and o.icomfly_created_at >= '2026-07-25'
), m as (
  select so.name, ic.id,
         count(*) over (partition by so.name) a,
         count(*) over (partition by ic.id) b
    from so join ic on ic.ph = so.ph and length(so.ph) = 8
     and abs(extract(epoch from (ic.c - so.c))) <= 600
)
insert into public.icomfly_vinculos_shopify (store_id, icomfly_order_id, shopify_name)
select 1, id, name from m where a = 1 and b = 1
on conflict do nothing;
