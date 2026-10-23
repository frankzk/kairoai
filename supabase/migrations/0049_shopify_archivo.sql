-- Respaldo completo de Shopify antes de que se suspendan las tiendas (28/10/2026).
--
-- shopify_orders guarda un recorte de 19 campos por pedido: lo que Kairo usa a
-- diario. Aca va el objeto ENTERO que devuelve el Admin API, para pedidos,
-- clientes y productos: descuentos, envio cobrado, reembolsos, transacciones,
-- tags, canal y UTM de origen, variantes y precios del catalogo. Despues del 28
-- Shopify deja de responder y esto es lo unico que queda.
--
-- Lo llena el cron /api/cron/shopify-archivo (lib/shopify-archivo.ts): una pasada
-- completa reanudable y, despues, lo que cambie hasta el ultimo dia.

CREATE TABLE IF NOT EXISTS public.shopify_archivo (
  store_id BIGINT NOT NULL REFERENCES public.stores(id),
  recurso TEXT NOT NULL CHECK (recurso IN ('order', 'customer', 'product')),
  shopify_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  shopify_updated_at TIMESTAMPTZ,
  archivado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, recurso, shopify_id)
);

-- Por donde va cada pasada: el cursor de Shopify (header Link) para reanudar en
-- la corrida siguiente sin volver a empezar.
CREATE TABLE IF NOT EXISTS public.shopify_archivo_estado (
  store_id BIGINT NOT NULL REFERENCES public.stores(id),
  recurso TEXT NOT NULL CHECK (recurso IN ('order', 'customer', 'product')),
  next_url TEXT,
  completo BOOLEAN NOT NULL DEFAULT false,
  archivados INTEGER NOT NULL DEFAULT 0,
  pasada_iniciada_at TIMESTAMPTZ,
  completado_at TIMESTAMPTZ,
  incremental_desde TIMESTAMPTZ,
  ultimo_error TEXT,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, recurso)
);

-- Las fotos del catalogo, copiadas al bucket: la URL de Shopify puede dejar de
-- servir cuando la tienda se suspenda.
CREATE TABLE IF NOT EXISTS public.shopify_archivo_imagenes (
  store_id BIGINT NOT NULL REFERENCES public.stores(id),
  product_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  src TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content_type TEXT,
  bytes INTEGER,
  archivado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, image_id)
);

-- Datos de clientes: solo entra el service role, como el resto del repo.
ALTER TABLE public.shopify_archivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_archivo_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_archivo_imagenes ENABLE ROW LEVEL SECURITY;

-- Bucket PRIVADO para las fotos. Sin politicas para anon/authenticated.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shopify-archivo',
  'shopify-archivo',
  false,
  20971520, -- 20 MB por foto
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

NOTIFY pgrst, 'reload schema';
