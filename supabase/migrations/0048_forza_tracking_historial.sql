-- Forza: marca las guias leidas con el historial completo.
--
-- Kairo leia de Forza solo los 5 hitos de su linea de tiempo (Creado, Recibido,
-- En instalaciones, En Ruta, Entregado) y deducia los intentos fallidos de sus
-- fechas: las incidencias llegaban a Novedades 1 o 2 dias tarde y sin motivo, y
-- una devolucion se veia como "Entregado". Ahora lee el historial completo
-- (incidencias con su motivo, devoluciones, anulaciones) y con la hora de
-- Honduras: antes la guardaba como UTC, 6 horas corrida.
--
-- historial = true: los eventos son el historial completo. false: son los 5
-- hitos de antes. El cron vuelve a leer, con el cupo que le sobra, las guias
-- cerradas de los ultimos 90 dias que siguen en false, de la mas reciente a la
-- mas vieja, para que el estado (entregada o devuelta) y los intentos queden
-- bien tambien en las que ya no se mueven.
--
-- Solo agrega una columna con default: el codigo anterior sigue funcionando
-- igual, asi que se puede aplicar antes del deploy.

alter table public.forza_tracking add column if not exists historial boolean not null default false;
