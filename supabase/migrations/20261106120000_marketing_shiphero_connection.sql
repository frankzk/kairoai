-- Conexión de Marketing con ShipHero (06/11/2026). Una fila por tienda.
--
-- Guarda el acceso que entrega ShipHero (refresh token y access token en
-- caché) CIFRADO con AES-256-GCM en la app (clave SHIPHERO_TOKEN_KEY, ver
-- lib/secret-box.ts). La contraseña del usuario NUNCA llega a la base: se usa
-- una sola vez contra /auth/token de ShipHero y se descarta.
--
-- Sin esta migración, Marketing funciona igual (CSV product_table) y la
-- tarjeta de ShipHero dice "Pendiente: aplicar migración de ShipHero".
--
-- Aditiva e idempotente. Solo service role (RLS sin políticas). Sin DELETE:
-- desconectar es un UPDATE que borra el acceso guardado, no la fila.

create table if not exists public.marketing_shiphero_connection (
  store_id            bigint primary key references public.stores(id),
  state               text not null default 'disconnected'
                        check (state in ('connected','needs_scope','reconnect','disconnected')),
  auth_method         text check (auth_method in ('password','refresh_token')),
  -- Formato "v1.<kid>.<iv>.<tag>.<ct>" (lib/secret-box.ts). Nunca texto plano.
  refresh_token_enc   text check (refresh_token_enc is null or (refresh_token_enc like 'v1.%' and length(refresh_token_enc) <= 4000)),
  access_token_enc    text check (access_token_enc  is null or (access_token_enc  like 'v1.%' and length(access_token_enc)  <= 12000)),
  access_expires_at   timestamptz,
  -- Sube en cada conectar/desconectar/cambio de alcance: un refresh o una
  -- lectura que termina tarde no resucita un acceso viejo ni guarda una foto
  -- de otro alcance (update ... where token_generation = <leída>).
  token_generation    integer not null default 0,
  -- Quién y qué cuenta (sin secretos).
  sh_user_email       text check (length(sh_user_email) <= 200),
  sh_account_id       text check (length(sh_account_id) <= 100),
  sh_account_legacy_id bigint,
  is_3pl              boolean,
  customer_account_id text check (length(customer_account_id) <= 100),
  customer_name       text check (length(customer_name) <= 200),
  warehouse_id        text check (length(warehouse_id) <= 100),
  warehouse_name      text check (length(warehouse_name) <= 200),
  -- Opciones descubiertas para elegir (ids y nombres; nada secreto).
  choices             jsonb not null default '{"warehouses":[],"customers":[]}'::jsonb
                        check (pg_column_size(choices) <= 65536),
  connected_by        text check (length(connected_by) <= 200),   -- "id:nombre"
  connected_at        timestamptz,
  disconnected_by     text check (length(disconnected_by) <= 200),
  disconnected_at     timestamptz,
  last_sync_at        timestamptz,       -- último intento
  last_sync_ok_at     timestamptz,       -- último guardado de foto
  last_sync_rows      integer,
  last_sync_incoming  boolean,           -- la foto trae "en camino" completo
  last_error          text check (length(last_error) <= 300),     -- mensaje corto en español, sin secretos
  last_error_at       timestamptz,
  -- Una sola sincronización/refresh a la vez (ShipHero: nunca en paralelo).
  lease_token         uuid,
  lease_until         timestamptz,
  -- Límite de intentos de conectar (5 cada 15 min por tienda).
  connect_attempts    smallint not null default 0,
  connect_window_at   timestamptz,
  updated_at          timestamptz not null default now()
);

alter table public.marketing_shiphero_connection enable row level security;
revoke all on table public.marketing_shiphero_connection from public, anon, authenticated;
-- Sin DELETE: desconectar es un UPDATE que borra el acceso, no la fila.
grant select, insert, update on table public.marketing_shiphero_connection to service_role;

-- Cuenta un intento de conectar; false = demasiados intentos.
create or replace function public.marketing_shiphero_connect_attempt(p_store bigint)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_attempts smallint;
begin
  insert into public.marketing_shiphero_connection (store_id) values (p_store)
    on conflict (store_id) do nothing;
  update public.marketing_shiphero_connection
     set connect_attempts = case when connect_window_at is null or connect_window_at < now() - interval '15 minutes'
                                 then 1 else least(connect_attempts + 1, 1000) end,
         connect_window_at = case when connect_window_at is null or connect_window_at < now() - interval '15 minutes'
                                  then now() else connect_window_at end
   where store_id = p_store
  returning connect_attempts into v_attempts;
  return v_attempts <= 5;
end $$;

-- Toma el turno de sincronizar; null si otro lo tiene.
create or replace function public.marketing_shiphero_lease(p_store bigint, p_seconds integer)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_token uuid;
begin
  if p_seconds is null or p_seconds < 10 or p_seconds > 600 then raise exception 'Turno inválido'; end if;
  update public.marketing_shiphero_connection
     set lease_token = gen_random_uuid(), lease_until = now() + make_interval(secs => p_seconds)
   where store_id = p_store and (lease_until is null or lease_until < now())
  returning lease_token into v_token;
  return v_token;
end $$;

-- Suelta el turno solo si sigue siendo el mismo.
create or replace function public.marketing_shiphero_release(p_store bigint, p_token uuid)
returns void language sql security invoker set search_path = public as $$
  update public.marketing_shiphero_connection
     set lease_token = null, lease_until = null
   where store_id = p_store and lease_token = p_token;
$$;

-- Alcance de cada foto ShipHero: "<cuenta>|<cliente>|<almacén>" (solo ids,
-- nada secreto). El tablero solo usa fotos del alcance actual de la conexión:
-- un cambio de cliente/almacén o de cuenta nunca mezcla inventarios.
alter table public.marketing_inventory_snapshots
  add column if not exists scope_key text
    check (scope_key is null or length(scope_key) <= 400);

-- Igual que marketing_replace_inventory_snapshot (20261105120400), pero para
-- source = 'shiphero'. Solo reemplaza la foto ShipHero de ese día: nunca toca
-- las fotos CSV ni los días anteriores (historial de reposición).
-- Guarda solo si la conexión sigue igual que al empezar la lectura (misma
-- token_generation, mismo alcance, conectada); si no, no guarda nada y
-- devuelve null. El FOR UPDATE ordena dos guardados del mismo día.
create or replace function public.marketing_replace_shiphero_snapshot(
  p_store bigint, p_date date, p_meta jsonb, p_items jsonb,
  p_generation integer, p_scope text
) returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_conn public.marketing_shiphero_connection%rowtype;
begin
  if p_store is null or p_date is null or p_generation is null or p_scope is null
     or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Inventario inválido';
  end if;
  if jsonb_array_length(p_items) > 20000 then raise exception 'Demasiadas filas'; end if;

  select * into v_conn from public.marketing_shiphero_connection
   where store_id = p_store for update;
  if not found
     or v_conn.token_generation <> p_generation
     or v_conn.state not in ('connected', 'reconnect')
     or v_conn.refresh_token_enc is null
     or coalesce(v_conn.sh_account_id, '') || '|' || coalesce(v_conn.customer_account_id, '')
        || '|' || coalesce(v_conn.warehouse_id, '') <> p_scope then
    return null;
  end if;

  delete from public.marketing_inventory_snapshots
   where store_id = p_store and snapshot_date = p_date and source = 'shiphero';

  insert into public.marketing_inventory_snapshots (
    store_id, snapshot_date, source, file_name, row_count, error_count,
    unmatched_count, available_column, backorder_column, incoming_column, uploaded_by,
    scope_key
  ) values (
    p_store, p_date, 'shiphero',
    left(coalesce(p_meta->>'file_name', ''), 200),      -- "ShipHero · <almacén>"
    jsonb_array_length(p_items), 0,
    coalesce((p_meta->>'unmatched_count')::integer, 0),
    'available',
    left(coalesce(p_meta->>'backorder_column', ''), 60), -- 'backorder'
    left(coalesce(p_meta->>'incoming_column', ''), 60),  -- 'incoming' o '' si incompleto
    left(coalesce(p_meta->>'uploaded_by', ''), 200),     -- "cron" o "id:nombre"
    left(p_scope, 400)
  ) returning id into v_id;

  insert into public.marketing_inventory_items (
    snapshot_id, store_id, sku, sku_key, name, warehouses, available, on_hand,
    allocated, backorder, incoming
  )
  select v_id, p_store, btrim(x.sku), lower(btrim(x.sku)), left(coalesce(x.name, ''), 300),
         coalesce(x.warehouses, '{}'), x.available, x.on_hand, x.allocated, x.backorder, x.incoming
    from jsonb_to_recordset(p_items) as x(
      sku text, name text, warehouses text[], available numeric, on_hand numeric,
      allocated numeric, backorder numeric, incoming numeric);
  return v_id;
end $$;

-- Una versión anterior de este archivo creó la función sin guardia (4
-- argumentos). Si existe, nadie la puede llamar (no se borra: solo aditivo).
do $$
begin
  if to_regprocedure('public.marketing_replace_shiphero_snapshot(bigint, date, jsonb, jsonb)') is not null then
    revoke all on function public.marketing_replace_shiphero_snapshot(bigint, date, jsonb, jsonb)
      from public, anon, authenticated, service_role;
  end if;
end $$;

revoke all on function public.marketing_shiphero_connect_attempt(bigint) from public, anon, authenticated;
revoke all on function public.marketing_shiphero_lease(bigint, integer) from public, anon, authenticated;
revoke all on function public.marketing_shiphero_release(bigint, uuid) from public, anon, authenticated;
revoke all on function public.marketing_replace_shiphero_snapshot(bigint, date, jsonb, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.marketing_shiphero_connect_attempt(bigint) to service_role;
grant execute on function public.marketing_shiphero_lease(bigint, integer) to service_role;
grant execute on function public.marketing_shiphero_release(bigint, uuid) to service_role;
grant execute on function public.marketing_replace_shiphero_snapshot(bigint, date, jsonb, jsonb, integer, text) to service_role;

comment on table public.marketing_shiphero_connection is 'Conexión de Marketing con ShipHero por tienda. Tokens cifrados en la app (SHIPHERO_TOKEN_KEY); la contraseña nunca se guarda. Solo service role.';
comment on function public.marketing_replace_shiphero_snapshot(bigint, date, jsonb, jsonb, integer, text) is 'Reemplaza en una transacción la foto ShipHero del día (tienda, fecha) solo si la conexión no cambió (generación y alcance). No toca fotos CSV ni otros días. Solo service role.';
