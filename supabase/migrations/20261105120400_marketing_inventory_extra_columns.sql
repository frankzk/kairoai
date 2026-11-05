-- Inventario de Marketing: pedidos esperando stock y unidades en camino
-- (05/11/2026, módulo 5 "Inventario para decidir").
--
-- El CSV product_table de ShipHero/Boxful puede traer las columnas Backorder
-- (pedidos esperando stock) e Incoming (unidades en camino). Son opcionales:
-- si el archivo no las trae quedan null y Marketing lo dice ("el archivo no
-- trae esas columnas"). La foto guarda el encabezado que se usó para cada una.
--
-- Mientras esta migración no esté aplicada, Marketing guarda y lee el
-- inventario como antes (sin las dos columnas).

alter table public.marketing_inventory_items
  add column if not exists backorder numeric,
  add column if not exists incoming numeric;

alter table public.marketing_inventory_snapshots
  add column if not exists backorder_column text not null default ''
    check (length(backorder_column) <= 60),
  add column if not exists incoming_column text not null default ''
    check (length(incoming_column) <= 60);

-- Misma firma que en 20261105120000: ahora también guarda backorder e incoming.
create or replace function public.marketing_replace_inventory_snapshot(
  p_store bigint,
  p_date date,
  p_meta jsonb,
  p_items jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_store is null or p_date is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Inventario inválido';
  end if;
  if jsonb_array_length(p_items) > 20000 then
    raise exception 'Demasiadas filas';
  end if;

  delete from public.marketing_inventory_snapshots
   where store_id = p_store and snapshot_date = p_date and source = 'csv';

  insert into public.marketing_inventory_snapshots (
    store_id, snapshot_date, source, file_name, row_count, error_count,
    unmatched_count, available_column, backorder_column, incoming_column, uploaded_by
  ) values (
    p_store,
    p_date,
    'csv',
    left(coalesce(p_meta->>'file_name', ''), 200),
    jsonb_array_length(p_items),
    coalesce((p_meta->>'error_count')::integer, 0),
    coalesce((p_meta->>'unmatched_count')::integer, 0),
    left(coalesce(p_meta->>'available_column', ''), 60),
    left(coalesce(p_meta->>'backorder_column', ''), 60),
    left(coalesce(p_meta->>'incoming_column', ''), 60),
    left(coalesce(p_meta->>'uploaded_by', ''), 200)
  )
  returning id into v_id;

  insert into public.marketing_inventory_items (
    snapshot_id, store_id, sku, sku_key, name, warehouses, available, on_hand,
    allocated, backorder, incoming
  )
  select v_id, p_store, btrim(x.sku), lower(btrim(x.sku)), left(coalesce(x.name, ''), 300),
         coalesce(x.warehouses, '{}'), x.available, x.on_hand, x.allocated,
         x.backorder, x.incoming
    from jsonb_to_recordset(p_items) as x(
      sku text, name text, warehouses text[], available numeric, on_hand numeric,
      allocated numeric, backorder numeric, incoming numeric
    );

  return v_id;
end;
$$;

revoke all on function public.marketing_replace_inventory_snapshot(bigint, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.marketing_replace_inventory_snapshot(bigint, date, jsonb, jsonb) to service_role;

comment on column public.marketing_inventory_items.backorder is 'Pedidos esperando stock según el CSV (columna Backorder); null si el archivo no la trae.';
comment on column public.marketing_inventory_items.incoming is 'Unidades en camino según el CSV (columna Incoming); null si el archivo no la trae.';
comment on column public.marketing_inventory_snapshots.backorder_column is 'Encabezado del CSV usado para los pedidos esperando; vacío si no venía.';
comment on column public.marketing_inventory_snapshots.incoming_column is 'Encabezado del CSV usado para las unidades en camino; vacío si no venía.';
comment on function public.marketing_replace_inventory_snapshot(bigint, date, jsonb, jsonb) is 'Reemplaza en una transacción la foto CSV del día (tienda, fecha) con sus filas, incluidos pedidos esperando y unidades en camino. Solo service role.';
