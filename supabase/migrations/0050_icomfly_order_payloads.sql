-- El pedido de iComfly COMPLETO, tal como lo devuelve su API.
--
-- Desde el 28/10/2026 Shopify se suspende y la venta sigue por las paginas web
-- de iComfly. Hasta ahora icomfly_orders guarda solo el despacho (estado, guia,
-- courier, quien confirmo): sin cliente, telefono, direccion, productos ni
-- total. Para que Gestion → Pedidos, la cola de confirmacion y los KPI puedan
-- armarse desde iComfly, primero hay que ver y guardar lo que trae cada pedido.
--
-- Tabla aparte y no una columna en icomfly_orders: el dataset de Finanzas lee
-- icomfly_orders entera en cada reconstruccion y el pedido crudo la haria lenta.

CREATE TABLE IF NOT EXISTS public.icomfly_order_payloads (
  store_id BIGINT NOT NULL REFERENCES public.stores(id),
  icomfly_order_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, icomfly_order_id)
);

-- Datos de clientes: solo entra el service role, como el resto del repo.
ALTER TABLE public.icomfly_order_payloads ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
