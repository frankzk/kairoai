-- Por donde va la pasada completa de iComfly (lib/icomfly-historial.ts).
--
-- El cron de iComfly lee solo las 5 paginas mas nuevas (500 pedidos, ~4 dias
-- en Costa Rica). Desde el 28/10/2026 los pedidos viven solo en iComfly: hace
-- falta el pedido completo de TODA la historia, y que un pedido de hace dos
-- semanas que se cancela o se entrega tambien se actualice. El cron
-- /api/cron/icomfly-historial recorre todas las paginas, reanudando donde
-- quedo, y cuando termina vuelve a empezar despues de unas horas.

CREATE TABLE IF NOT EXISTS public.icomfly_historial_estado (
  store_id BIGINT PRIMARY KEY REFERENCES public.stores(id),
  next_page INTEGER NOT NULL DEFAULT 1,
  completo BOOLEAN NOT NULL DEFAULT false,
  pasadas INTEGER NOT NULL DEFAULT 0,
  -- Pedidos guardados en la pasada en curso.
  pedidos INTEGER NOT NULL DEFAULT 0,
  pasada_iniciada_at TIMESTAMPTZ,
  completado_at TIMESTAMPTZ,
  ultimo_error TEXT,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solo entra el service role, como el resto del repo.
ALTER TABLE public.icomfly_historial_estado ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
