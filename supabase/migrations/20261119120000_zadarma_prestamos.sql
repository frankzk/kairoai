-- Extensiones de Zadarma dinámicas: se prestan a quien abre Kairo y quedan
-- libres al cerrar la página (o 2 min sin señal de vida). Así no hace falta
-- una extensión fija por asesora, y cada llamada se atribuye a quien tenía la
-- extensión a esa hora (zadarma_prestamos guarda el historial).
--
--   zadarma_extensiones: el grupo. `store_id` null = sirve a cualquier tienda;
--     con tienda, solo se presta para esa (el número que ve el cliente es el
--     CallerID de la extensión en Zadarma).
--   zadarma_prestamos: quién tuvo qué extensión y cuándo.
--   zadarma_prestar(...): presta (o renueva) en UNA sentencia con candado, para
--     que dos personas no reciban la misma extensión a la vez.
--   zadarma_devolver(...): la libera.
--
-- Solo service role (RLS activa sin políticas). Re-ejecutable.

create table if not exists public.zadarma_extensiones (
  sip       text primary key check (sip ~ '^[0-9]+-[0-9]{3}$'),
  store_id  bigint references public.stores(id) on delete set null,
  activa    boolean not null default true
);
alter table public.zadarma_extensiones enable row level security;

insert into public.zadarma_extensiones (sip, store_id) values
  ('499499-100', null), ('499499-101', null), ('499499-102', null),
  ('499499-103', null), ('499499-104', null), ('499499-105', null)
on conflict (sip) do nothing;

create table if not exists public.zadarma_prestamos (
  id             bigserial primary key,
  sip            text not null references public.zadarma_extensiones(sip) on delete cascade,
  kairo_user_id  bigint not null,
  staff_id       bigint,
  store_id       bigint,
  desde          timestamptz not null default now(),
  latido         timestamptz not null default now(),
  hasta          timestamptz
);
alter table public.zadarma_prestamos enable row level security;
create index if not exists zadarma_prestamos_abiertos on public.zadarma_prestamos (sip) where hasta is null;
create index if not exists zadarma_prestamos_sip_desde on public.zadarma_prestamos (sip, desde desc);

-- Presta una extensión a (usuario, asesora) para la tienda, o renueva la que ya
-- tiene. Cierra los préstamos sin señal de vida hace más de p_vence_seg.
create or replace function public.zadarma_prestar(
  p_user bigint, p_staff bigint, p_store bigint, p_vence_seg int default 120
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sip text;
  v_ahora timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('zadarma_prestar'));

  update zadarma_prestamos set hasta = latido
   where hasta is null and latido < v_ahora - make_interval(secs => p_vence_seg);

  -- Ya tiene una abierta (otra pestaña, o la señal de vida): se renueva.
  select p.sip into v_sip from zadarma_prestamos p
    join zadarma_extensiones e on e.sip = p.sip and e.activa
   where p.hasta is null and p.kairo_user_id = p_user
     and coalesce(p.staff_id, -1) = coalesce(p_staff, -1)
     and (e.store_id is null or e.store_id = p_store)
   order by p.desde desc limit 1;
  if v_sip is not null then
    update zadarma_prestamos set latido = v_ahora
     where hasta is null and kairo_user_id = p_user and sip = v_sip;
    return v_sip;
  end if;

  -- Una libre: primero la de su tienda, después la que esa asesora usó la
  -- última vez (o tiene fija en la planilla), después cualquiera.
  select e.sip into v_sip from zadarma_extensiones e
   where e.activa and (e.store_id is null or e.store_id = p_store)
     and not exists (select 1 from zadarma_prestamos p where p.sip = e.sip and p.hasta is null)
   order by (e.store_id is not distinct from p_store) desc,
            (e.sip = (select ps.zadarma_sip from payroll_staff ps where ps.id = p_staff)) desc,
            (select max(p.desde) from zadarma_prestamos p
              where p.sip = e.sip and p.staff_id is not distinct from p_staff and p_staff is not null) desc nulls last,
            e.sip
   limit 1;
  if v_sip is null then
    return null;
  end if;
  insert into zadarma_prestamos (sip, kairo_user_id, staff_id, store_id, desde, latido)
  values (v_sip, p_user, p_staff, p_store, v_ahora, v_ahora);
  return v_sip;
end $$;

create or replace function public.zadarma_devolver(p_user bigint, p_sip text)
returns void
language sql security definer set search_path = public as $$
  update zadarma_prestamos set hasta = now()
   where hasta is null and kairo_user_id = p_user and sip = p_sip;
$$;

revoke all on function public.zadarma_prestar(bigint, bigint, bigint, int) from public, anon, authenticated;
revoke all on function public.zadarma_devolver(bigint, text) from public, anon, authenticated;
