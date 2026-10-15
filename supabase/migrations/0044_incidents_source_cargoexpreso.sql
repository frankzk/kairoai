-- Novedades de Cargo Expreso (Honduras) en la misma bandeja que Forza.
--
-- La deteccion (lib/incidents-run.ts) ahora recorre tambien el rastreo de
-- Cargo Expreso (courier_shipments, courier_code = 'cargoexpreso') y guarda las
-- novedades con source = 'cargoexpreso'. Sin este cambio el primer insert rompe
-- la corrida entera del cron de incidencias (lo mismo que paso con WYN, 0039).
--
-- Solo agrega un valor permitido: ninguna fila existente cambia y el codigo
-- anterior sigue funcionando igual, asi que se puede aplicar antes del deploy.

alter table public.incidents drop constraint if exists incidents_source_check;
alter table public.incidents
  add constraint incidents_source_check
  check (source = any (array['moovin'::text, 'forza'::text, 'wyn'::text, 'cargoexpreso'::text, 'boxful'::text, 'manual'::text]));
