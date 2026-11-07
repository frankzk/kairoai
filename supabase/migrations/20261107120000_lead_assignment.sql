-- Reparto automático de leads entre las asesoras activas (por tienda).
--
-- QUÉ HACE: cuando el interruptor de la tienda está encendido, el cron
-- `leads-assignment` (cada 5 min) le pone dueña a cada lead abierto (Hoy +
-- Seguimiento) en `leads.claimed_by` / `claimed_at`, repartiendo en el orden de
-- la cola entre las asesoras que el panel de Productividad muestra como
-- "Activa". Apagado no hace nada y el tablero se ve como siempre.
--
-- PIEZAS:
--   - lead_assignment_settings: el interruptor por tienda (apagado por defecto)
--     y el turno del cron (una corrida a la vez por tienda).
--   - leads.claimed_by pasa a ser el USUARIO de Kairo (kairo_users.id). Hasta
--     acá era una FK a payroll_staff para un "Tomar lead" que nunca se
--     construyó: nada la leía ni la escribía.
--   - lead_assignment_lease / _release: el turno (patrón de
--     marketing_shiphero_lease).
--   - lead_assignment_activity: qué leads asignados no se pueden mover (su
--     dueña ya los trabajó, o alguien los trabajó hace poco) y quién trabajó
--     hace poco los que no tienen dueña. Un solo viaje, devuelve jsonb (sin el
--     tope de 1.000 filas de PostgREST).
--   - lead_assignment_apply: aplica todos los cambios de una corrida en UNA
--     sentencia, solo si el turno sigue siendo suyo y el interruptor sigue
--     encendido, y vuelve a comprobar que la dueña anterior no tocó el lead
--     mientras tanto.
--
-- Solo service role (RLS activa sin políticas). Re-ejecutable.

create table if not exists public.lead_assignment_settings (
  store_id          bigint primary key references public.stores(id) on delete cascade,
  enabled           boolean not null default false,
  updated_by        text check (updated_by is null or length(updated_by) <= 200),
  updated_at        timestamptz not null default now(),
  -- Una sola corrida del reparto a la vez por tienda.
  lease_token       uuid,
  lease_until       timestamptz,
  last_run_at       timestamptz,
  last_run_summary  jsonb
);

alter table public.lead_assignment_settings enable row level security;
revoke all on table public.lead_assignment_settings from public, anon, authenticated;
grant select, insert, update on table public.lead_assignment_settings to service_role;

-- claimed_by: de payroll_staff a kairo_users. Solo la PRIMERA vez (cuando
-- todavía existe la FK vieja) se limpian valores sueltos: serían ids de
-- planilla, no de usuario. Al re-ejecutar, la FK vieja ya no está y las
-- asignaciones vigentes no se tocan.
do $$
declare r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
     where con.conrelid = 'public.leads'::regclass
       and con.contype = 'f'
       and a.attname = 'claimed_by'
       and con.confrelid = 'public.payroll_staff'::regclass
  loop
    execute format('alter table public.leads drop constraint %I', r.conname);
    update public.leads set claimed_by = null, claimed_at = null where claimed_by is not null;
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'leads_claimed_by_kairo_user_fkey'
       and conrelid = 'public.leads'::regclass
  ) then
    alter table public.leads
      add constraint leads_claimed_by_kairo_user_fkey
      foreign key (claimed_by) references public.kairo_users(id) on delete set null;
  end if;
end $$;

create index if not exists leads_store_claimed_idx
  on public.leads (store_id, claimed_by)
  where claimed_by is not null;

comment on column public.leads.claimed_by is
  'Asesora dueña del lead (kairo_users.id) según el reparto automático. Se ignora con el reparto apagado.';
comment on column public.leads.claimed_at is
  'Cuándo se le asignó el lead a claimed_by. Lo trabajado por ella desde entonces ya no se le quita.';

-- Toma el turno de repartir; null si otro lo tiene o el reparto está apagado.
create or replace function public.lead_assignment_lease(p_store bigint, p_seconds integer)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_token uuid;
begin
  if p_seconds is null or p_seconds < 10 or p_seconds > 600 then raise exception 'Turno inválido'; end if;
  update public.lead_assignment_settings
     set lease_token = gen_random_uuid(), lease_until = now() + make_interval(secs => p_seconds)
   where store_id = p_store and enabled and (lease_until is null or lease_until < now())
  returning lease_token into v_token;
  return v_token;
end $$;

-- Suelta el turno solo si sigue siendo el mismo, y deja el resumen de la corrida.
create or replace function public.lead_assignment_release(p_store bigint, p_token uuid, p_summary jsonb)
returns void language sql security invoker set search_path = public as $$
  update public.lead_assignment_settings
     set lease_token = null, lease_until = null, last_run_at = now(),
         last_run_summary = coalesce(p_summary, last_run_summary)
   where store_id = p_store and lease_token = p_token;
$$;

-- p_lead_ids: los leads con dueña que el cron esta repartiendo (Hoy +
-- Seguimiento). Se pasan para no recorrer los cerrados que conservan claimed_by.
-- protected: de esos, los que NO se pueden mover ni liberar:
--   a) la dueña los trabajó desde que se los asignaron (gestión, nota, mensaje
--      o llamada a su nombre o con su usuario), o
--   b) alguien los trabajó en los últimos p_recent_minutes.
-- recent: leads SIN dueña que una persona trabajó en los últimos
--   p_recent_minutes, con quién (el último usuario). Se le asignan a ella.
create or replace function public.lead_assignment_activity(p_store bigint, p_recent_minutes integer, p_lead_ids bigint[])
returns jsonb language sql stable security invoker set search_path = public as $$
  with params as (
    select now() - make_interval(mins => greatest(coalesce(p_recent_minutes, 30), 0)) as recent_since
  ),
  protegidos as (
    select l.id
      from public.leads l
      left join public.kairo_users u on u.id = l.claimed_by
      cross join params p
     where l.store_id = p_store
       and l.id = any(coalesce(p_lead_ids, '{}'::bigint[]))
       and l.claimed_by is not null
       and (
         exists (
           select 1 from public.lead_calls c
            where c.lead_id = l.id
              and (l.claimed_at is null or c.occurred_at >= l.claimed_at)
              and (c.kairo_user_id = l.claimed_by or (u.staff_id is not null and c.vendedora = u.staff_id))
         )
         or exists (
           select 1 from public.zadarma_calls z
            where z.lead_id = l.id
              and u.staff_id is not null and z.vendedora = u.staff_id
              and (l.claimed_at is null or z.started_at >= l.claimed_at)
         )
         or exists (
           select 1 from public.lead_calls c
            where c.lead_id = l.id
              and c.occurred_at >= p.recent_since
              and (c.kairo_user_id is not null or c.vendedora is not null)
         )
         or exists (
           select 1 from public.zadarma_calls z
            where z.lead_id = l.id
              and z.started_at >= p.recent_since
         )
       )
  ),
  recientes as (
    select distinct on (c.lead_id) c.lead_id, c.kairo_user_id
      from public.lead_calls c
      join public.leads l on l.id = c.lead_id
      cross join params p
     where c.store_id = p_store
       and c.occurred_at >= p.recent_since
       and c.kairo_user_id is not null
       and l.claimed_by is null
     order by c.lead_id, c.occurred_at desc
  )
  select jsonb_build_object(
    'protected', coalesce((select jsonb_agg(id) from protegidos), '[]'::jsonb),
    'recent', coalesce(
      (select jsonb_agg(jsonb_build_object('lead_id', lead_id, 'user_id', kairo_user_id)) from recientes),
      '[]'::jsonb
    )
  );
$$;

-- Aplica una corrida: [{lead_id, from_user, to_user}]. Devuelve cuántos leads
-- cambiaron, o -1 si el turno ya no es suyo o el reparto se apagó (no toca nada).
-- Un cambio solo se aplica si el lead sigue con la dueña que vio el cron, y,
-- si se lo quita a alguien, si ella no lo trabajó entretanto.
create or replace function public.lead_assignment_apply(p_store bigint, p_token uuid, p_changes jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_count integer;
begin
  if p_token is null or not exists (
    select 1 from public.lead_assignment_settings s
     where s.store_id = p_store and s.enabled and s.lease_token = p_token and s.lease_until > now()
  ) then
    return -1;
  end if;
  update public.leads l
     set claimed_by = c.to_user, claimed_at = now()
    from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as c(lead_id bigint, from_user bigint, to_user bigint)
   where l.id = c.lead_id
     and l.store_id = p_store
     and c.to_user is not null
     and l.claimed_by is not distinct from c.from_user
     and exists (select 1 from public.kairo_users u where u.id = c.to_user and u.activo)
     and (
       c.from_user is null
       or not exists (
         select 1
           from public.lead_calls lc
           left join public.kairo_users fu on fu.id = c.from_user
          where lc.lead_id = l.id
            and (l.claimed_at is null or lc.occurred_at >= l.claimed_at)
            and (lc.kairo_user_id = c.from_user or (fu.staff_id is not null and lc.vendedora = fu.staff_id))
       )
     );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.lead_assignment_lease(bigint, integer) from public, anon, authenticated;
revoke all on function public.lead_assignment_release(bigint, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lead_assignment_activity(bigint, integer, bigint[]) from public, anon, authenticated;
revoke all on function public.lead_assignment_apply(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.lead_assignment_lease(bigint, integer) to service_role;
grant execute on function public.lead_assignment_release(bigint, uuid, jsonb) to service_role;
grant execute on function public.lead_assignment_activity(bigint, integer, bigint[]) to service_role;
grant execute on function public.lead_assignment_apply(bigint, uuid, jsonb) to service_role;

comment on table public.lead_assignment_settings is
  'Reparto automático de leads por tienda (apagado por defecto) y turno del cron leads-assignment. Solo service role.';
