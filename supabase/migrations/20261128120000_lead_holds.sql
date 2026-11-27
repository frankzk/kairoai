-- Leads: una asesora a la vez por lead (28/11/2026).
--
-- Pedido de la dueña: cuando una asesora tiene abierto un lead, otra no lo
-- puede abrir; un aviso dice quién lo tiene, y la reserva dura como máximo 10
-- minutos (después se suelta sola).
--
-- `lead_holds` guarda UNA fila por lead reservado: quién lo abrió (id de
-- kairo_users; 0 = administrador de la contraseña compartida, que no tiene
-- fila, por eso no hay FK), su nombre para el aviso, y desde / hasta cuándo.
-- Al cerrar la ficha la app borra la fila; si eso falla, `expires_at` la
-- libera igual. Las filas vencidas no estorban: la siguiente apertura las
-- pisa.
--
-- `lead_hold_acquire` toma la reserva en UNA sentencia (insert … on conflict
-- do update … where), así dos asesoras que abren el mismo lead en el mismo
-- segundo no pueden ganar las dos. Reglas (las mismas de lib/lead-holds.ts ›
-- decideAcquire):
--   - Sin reserva o con la reserva vencida: la toma quien abre, por p_ttl.
--   - Reserva vigente de la misma persona: NO se alarga (máximo 10 minutos).
--   - Reserva vigente de otra persona: no cambia; con p_takeover (supervisión,
--     lo decide la app con el permiso leads_equipo) pasa a quien abre.
-- Devuelve la fila resultante y la hora del servidor; la app compara el
-- titular con quien pidió.
--
-- Lecturas de la app (todas pequeñas):
--   - Antes de cada escritura de un lead: la fila por PK (lead_id).
--   - El tablero: las reservas vigentes de la tienda, con el índice
--     (store_id, expires_at); son tantas como asesoras con un lead abierto.
--
-- Solo service role (RLS activa sin políticas), como lead_presence. Sin datos
-- del cliente. Re-ejecutable. Sin ella los leads se abren como siempre (la app
-- lo detecta y no reserva).

create table if not exists public.lead_holds (
  lead_id         bigint      primary key references public.leads(id) on delete cascade,
  store_id        bigint      not null references public.stores(id) on delete cascade,
  holder_user_id  bigint      not null,
  holder_name     text        not null,
  acquired_at     timestamptz not null,
  expires_at      timestamptz not null,
  constraint lead_holds_name_size check (char_length(holder_name) between 1 and 120),
  constraint lead_holds_window check (
    expires_at > acquired_at and expires_at <= acquired_at + interval '1 hour'
  )
);

-- El tablero: reservas vigentes de la tienda (expires_at > now()).
create index if not exists lead_holds_store_expires_idx
  on public.lead_holds (store_id, expires_at);
-- Limpieza al tomar una reserva: las vencidas de la misma persona.
create index if not exists lead_holds_holder_idx
  on public.lead_holds (holder_user_id);

alter table public.lead_holds enable row level security;
revoke all on public.lead_holds from public, anon, authenticated;
grant select, insert, update, delete on public.lead_holds to service_role;

create or replace function public.lead_hold_acquire(
  p_lead_id bigint,
  p_store_id bigint,
  p_user_id bigint,
  p_user_name text,
  p_ttl_seconds integer,
  p_takeover boolean
) returns table (
  lead_id bigint,
  holder_user_id bigint,
  holder_name text,
  acquired_at timestamptz,
  expires_at timestamptz,
  server_now timestamptz
) language plpgsql security invoker set search_path = '' as $$
declare
  stamp timestamptz := clock_timestamp();
  name_clean text := left(btrim(coalesce(p_user_name, '')), 120);
begin
  if p_lead_id is null or p_store_id is null or p_user_id is null or p_user_id < 0
    or p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600
    or p_takeover is null then
    raise exception 'Invalid lead hold request';
  end if;
  if name_clean = '' then name_clean := 'Otra persona'; end if;
  if not exists (
    select 1 from public.leads l where l.id = p_lead_id and l.store_id = p_store_id
  ) then
    raise exception 'Lead not found in store';
  end if;

  -- Reservas vencidas de esta persona en otros leads (no se soltaron al
  -- cerrar): pocas filas por el índice de titular.
  delete from public.lead_holds h
  where h.holder_user_id = p_user_id and h.lead_id <> p_lead_id and h.expires_at <= stamp;

  insert into public.lead_holds as h
    (lead_id, store_id, holder_user_id, holder_name, acquired_at, expires_at)
  values
    (p_lead_id, p_store_id, p_user_id, name_clean, stamp, stamp + make_interval(secs => p_ttl_seconds))
  on conflict on constraint lead_holds_pkey do update set
    store_id = excluded.store_id,
    holder_user_id = excluded.holder_user_id,
    holder_name = excluded.holder_name,
    acquired_at = excluded.acquired_at,
    expires_at = excluded.expires_at
  -- Vencida: la toma cualquiera. Vigente de otra persona: solo con takeover.
  -- Vigente de la misma persona: no se toca (no se alarga).
  where h.expires_at <= stamp
     or (p_takeover and h.holder_user_id <> p_user_id);

  -- ON CONFLICT bloquea la fila aunque el WHERE no la actualice: lo que se
  -- lee aquí es lo que quedó, sin carrera con otra apertura.
  return query
    select h.lead_id, h.holder_user_id, h.holder_name, h.acquired_at, h.expires_at, stamp
    from public.lead_holds h
    where h.lead_id = p_lead_id;
end;
$$;

revoke all on function public.lead_hold_acquire(bigint, bigint, bigint, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.lead_hold_acquire(bigint, bigint, bigint, text, integer, boolean)
  to service_role;

comment on table public.lead_holds is
  'Reserva de un lead por quien lo tiene abierto (máx. 10 min, sin alargar). Service-role only; sin datos del cliente.';

notify pgrst, 'reload schema';
