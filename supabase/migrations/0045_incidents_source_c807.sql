-- Novedades de c807 Xpress (Honduras) en la misma bandeja que Forza y Cargo Expreso.
--
-- La deteccion (lib/incidents-run.ts) ahora recorre tambien el rastreo de c807
-- (courier_shipments, courier_code = 'c807') y guarda las novedades con
-- source = 'c807'. Sin este cambio el primer insert rompe la corrida entera del
-- cron de incidencias (lo mismo que paso con WYN, 0039).
--
-- Solo agrega un valor permitido: ninguna fila existente cambia y el codigo
-- anterior sigue funcionando igual, asi que se puede aplicar antes del deploy.

alter table public.incidents drop constraint if exists incidents_source_check;
alter table public.incidents
  add constraint incidents_source_check
  check (source = any (array['moovin'::text, 'forza'::text, 'wyn'::text, 'cargoexpreso'::text, 'c807'::text, 'boxful'::text, 'manual'::text]));
