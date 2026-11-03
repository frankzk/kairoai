-- Tablero de Marketing (03/11/2026): el origen de los pedidos del periodo se
-- lee por tienda y fecha de creacion en iComfly (lib/marketing-origen.ts).
-- Sin este indice, cada consulta recorre los ~47 mil pedidos.
create index if not exists icomfly_orders_creado_idx
  on public.icomfly_orders (store_id, icomfly_created_at);
