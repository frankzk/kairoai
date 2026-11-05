-- Inventario de Marketing desde el archivo product_table (05/11/2026).
--
-- ShipHero/Boxful exporta a diario el CSV product_table. Mientras no haya
-- acceso a la API de ShipHero, Marketing permite subir ese archivo: cada
-- subida guarda una foto del inventario del día (hora de Costa Rica). Se
-- conservan todos los días, así "entró reposición" compara la última foto
-- con la del día anterior.
--
-- Subir otra vez el mismo día reemplaza la foto de ese día en una sola
-- transacción (función marketing_replace_inventory_snapshot).
--
-- Solo el servidor la lee y escribe (service role): RLS sin políticas.

create table if not exists public.marketing_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id bigint not null references public.stores(id),
  snapshot_date date not null,
  source text not null check (source in ('csv','shiphero')),
  file_name text not null default '' check (length(file_name) <= 200),
  row_count integer not null check (row_count between 0 and 20000),
  error_count integer not null default 0 check (error_count >= 0),
  unmatched_count integer not null default 0 check (unmatched_count >= 0),
  available_column text not null default '' check (length(available_column) <= 60),
  uploaded_by text not null check (length(uploaded_by) <= 200),
  uploaded_at timestamptz not null default now(),
  unique (store_id, snapshot_date, source)
);

create table if not exists public.marketing_inventory_items (
  snapshot_id uuid not null references public.marketing_inventory_snapshots(id) on delete cascade,
  store_id bigint not null references public.stores(id),
  sku text not null check (length(sku) between 1 and 100),
  sku_key text not null check (sku_key = lower(btrim(sku))),
  name text not null default '' check (length(name) <= 300),
  warehouses text[] not null default '{}',
  available numeric not null,
  on_hand numeric,
  allocated numeric,
  primary key (snapshot_id, sku_key)
);

create index if not exists marketing_inventory_snapshots_latest
  on public.marketing_inventory_snapshots (store_id, snapshot_date desc);

-- Reemplaza la foto CSV de un día: borra la anterior (sus filas caen en
-- cascada) e inserta la nueva con sus filas, todo o nada.
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
    unmatched_count, available_column, uploaded_by
  ) values (
    p_store,
    p_date,
    'csv',
    left(coalesce(p_meta->>'file_name', ''), 200),
    jsonb_array_length(p_items),
    coalesce((p_meta->>'error_count')::integer, 0),
    coalesce((p_meta->>'unmatched_count')::integer, 0),
    left(coalesce(p_meta->>'available_column', ''), 60),
    left(coalesce(p_meta->>'uploaded_by', ''), 200)
  )
  returning id into v_id;

  insert into public.marketing_inventory_items (
    snapshot_id, store_id, sku, sku_key, name, warehouses, available, on_hand, allocated
  )
  select v_id, p_store, btrim(x.sku), lower(btrim(x.sku)), left(coalesce(x.name, ''), 300),
         coalesce(x.warehouses, '{}'), x.available, x.on_hand, x.allocated
    from jsonb_to_recordset(p_items) as x(
      sku text, name text, warehouses text[], available numeric, on_hand numeric, allocated numeric
    );

  return v_id;
end;
$$;

alter table public.marketing_inventory_snapshots enable row level security;
alter table public.marketing_inventory_items enable row level security;
revoke all on public.marketing_inventory_snapshots, public.marketing_inventory_items from public, anon, authenticated;
grant select, insert, update, delete on public.marketing_inventory_snapshots, public.marketing_inventory_items to service_role;
revoke all on function public.marketing_replace_inventory_snapshot(bigint, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.marketing_replace_inventory_snapshot(bigint, date, jsonb, jsonb) to service_role;

comment on table public.marketing_inventory_snapshots is 'Foto diaria del inventario de Costa Rica subida desde el CSV product_table (ShipHero/Boxful); acceso solo servidor con sesión Kairo y permiso de Marketing.';
comment on table public.marketing_inventory_items is 'Disponible por SKU de cada foto de inventario de Marketing; sku_key = SKU en minúsculas, igual que el catálogo.';
comment on function public.marketing_replace_inventory_snapshot(bigint, date, jsonb, jsonb) is 'Reemplaza en una transacción la foto CSV del día (tienda, fecha) con sus filas. Solo service role.';
