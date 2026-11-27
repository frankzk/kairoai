-- Anuncio de Meta que inició el chat de WhatsApp de cada pedido (27/11/2026).
--
-- iComfly sabe qué anuncio Click-to-WhatsApp abrió el chat detrás de un
-- pedido (GET /orders/{id}/whatsapp-ad-origin), pero los pedidos de WhatsApp
-- no traen UTM: Marketing no distinguía una venta del bot que vino de un
-- anuncio de una orgánica, ni podía contarla en su campaña.
--
-- El cron `icomfly-whatsapp-ads` (lib/icomfly-whatsapp-ad-db.ts) llena esta
-- tabla, de a pocos pedidos por corrida (≤ 60 por tienda cada 10 min). Guarda
-- también los pedidos SIN anuncio (has_ad = false) para no volver a pedirlos
-- (se revisan una sola vez más, a los 2 días), y los que no pueden venir de un
-- chat (skipped = true: web con UTM, Shopify). El anuncio se cruza con su
-- campaña leyendo Meta con la cuenta de la tienda (campaign_id y nombres);
-- Marketing solo la usa si la campaña está en su catálogo verificado.
--
-- Sin datos del cliente: solo ids y textos del anuncio. `raw` es la respuesta
-- de iComfly reducida a sus campos del anuncio (≤ 4 KB).
--
-- Solo service role (RLS activa sin políticas), como icomfly_order_payloads.
-- Re-ejecutable. Sin ella, el cron responde ok sin hacer nada y Marketing
-- muestra los pedidos del bot como "Bot · sin revisar".

create table if not exists public.icomfly_whatsapp_ad_origins (
  store_id          bigint      not null references public.stores(id),
  icomfly_order_id  text        not null,
  -- Fecha de creación del pedido (icomfly_orders.icomfly_created_at): Marketing
  -- lee por rango de fechas con el índice de abajo.
  order_created_at  timestamptz,
  checked_at        timestamptz not null default now(),
  -- Veces que se revisó (consulta a iComfly o clasificación): con 2 no se
  -- vuelve a revisar un pedido sin anuncio; con 3, uno que dio error.
  attempts          smallint    not null default 1,
  -- No puede venir de un chat (web con UTM, Shopify): no se consultó iComfly.
  skipped           boolean     not null default false,
  -- true = vino de un anuncio · false = chat sin anuncio · null = no se pudo
  -- consultar todavía (error) o no se consultó (skipped).
  has_ad            boolean,
  ad_id             text,
  headline          text,
  source_url        text,
  has_click         boolean,
  received_at       timestamptz,
  via               text,
  tipo              text,
  raw               jsonb,
  -- Campaña del anuncio según Meta (cuenta de la tienda): ok = leída,
  -- not_found = el anuncio no existe o no es de una cuenta de la tienda,
  -- null = todavía no se pudo leer.
  meta_status       text,
  meta_checked_at   timestamptz,
  meta_account_id   text,
  campaign_id       text,
  adset_id          text,
  ad_name           text,
  adset_name        text,
  campaign_name     text,
  primary key (store_id, icomfly_order_id),
  constraint icomfly_whatsapp_ad_origins_meta_status
    check (meta_status is null or meta_status in ('ok', 'not_found')),
  constraint icomfly_whatsapp_ad_origins_raw_size
    check (raw is null or pg_column_size(raw) <= 4096)
);

-- Marketing: los pedidos de un período (store + rango de creación).
create index if not exists icomfly_whatsapp_ad_origins_created
  on public.icomfly_whatsapp_ad_origins (store_id, order_created_at);
-- El cron: otros pedidos del mismo anuncio (para no volver a leer Meta).
create index if not exists icomfly_whatsapp_ad_origins_ad
  on public.icomfly_whatsapp_ad_origins (store_id, ad_id)
  where ad_id is not null;
-- El cron: anuncios cuya campaña falta leer en Meta (pocas filas).
create index if not exists icomfly_whatsapp_ad_origins_meta_pending
  on public.icomfly_whatsapp_ad_origins (store_id, checked_at desc)
  where has_ad and ad_id is not null and meta_status is null;

alter table public.icomfly_whatsapp_ad_origins enable row level security;

notify pgrst, 'reload schema';
