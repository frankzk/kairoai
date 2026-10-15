-- Novedades de WYN en la misma bandeja que Moovin y Forza.
--
-- La deteccion (lib/incidents-run.ts) ahora recorre tambien el rastreo de WYN
-- (courier_shipments, courier_code = 'wyn') y guarda las novedades con
-- source = 'wyn'. El CHECK de origen solo admitia moovin/forza/boxful/manual:
-- sin este cambio el primer insert de WYN rompe la corrida entera del cron de
-- incidencias, no solo la de WYN.
--
-- Solo agrega un valor permitido: ninguna fila existente cambia y el codigo
-- anterior sigue funcionando igual, asi que se puede aplicar antes del deploy.

alter table public.incidents drop constraint if exists incidents_source_check;
alter table public.incidents
  add constraint incidents_source_check
  check (source = any (array['moovin'::text, 'forza'::text, 'wyn'::text, 'boxful'::text, 'manual'::text]));
