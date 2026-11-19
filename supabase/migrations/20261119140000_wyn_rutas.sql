-- Rutas y días de entrega de WYN en Costa Rica (Mejoras Kairo N.º 2).
-- Se cargan desde el Excel de WYN (hoja "Frecuencias por zona") en
-- Configuración › Rutas de WYN; cada carga reemplaza todas las rutas.
--
-- Solo service role (RLS activa sin políticas). Re-ejecutable.

create table if not exists public.wyn_rutas (
  id      bigserial primary key,
  orden   int not null,
  region  text not null,
  hub     text not null default '',
  ruta    text not null,
  zonas   text[] not null,
  dias    smallint[] not null check (dias <@ array[1,2,3,4,5,6]::smallint[] and cardinality(dias) > 0),
  nota    text
);
alter table public.wyn_rutas enable row level security;

create table if not exists public.wyn_rutas_carga (
  id          int primary key default 1 check (id = 1),
  archivo     text,
  rutas       int not null default 0,
  cargado_por text,
  cargado_at  timestamptz not null default now()
);
alter table public.wyn_rutas_carga enable row level security;

-- Reemplaza todas las rutas en una sola transacción.
create or replace function public.wyn_rutas_reemplazar(p_rutas jsonb, p_archivo text, p_por text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  delete from wyn_rutas;
  insert into wyn_rutas (orden, region, hub, ruta, zonas, dias, nota)
  select (r->>'orden')::int, r->>'region', coalesce(r->>'hub', ''), r->>'ruta',
         array(select jsonb_array_elements_text(r->'zonas')),
         array(select (jsonb_array_elements_text(r->'dias'))::smallint),
         nullif(r->>'nota', '')
    from jsonb_array_elements(p_rutas) r;
  get diagnostics v_n = row_count;
  insert into wyn_rutas_carga (id, archivo, rutas, cargado_por, cargado_at)
  values (1, p_archivo, v_n, p_por, now())
  on conflict (id) do update set archivo = excluded.archivo, rutas = excluded.rutas, cargado_por = excluded.cargado_por, cargado_at = now();
  return v_n;
end $$;
revoke all on function public.wyn_rutas_reemplazar(jsonb, text, text) from public, anon, authenticated;
