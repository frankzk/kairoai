-- Estado incremental del cron de novedades.
-- Guarda, por fuente de tracking (Moovin global; Forza por tienda), el ultimo
-- checked_at procesado, para que cada corrida del cron solo mire lo que cambio
-- desde entonces en vez de reescanear todo el historico de tracking. Asi el
-- trabajo por corrida es proporcional al movimiento, no al total acumulado.
create table if not exists incident_sync_state (
  source_key text primary key,
  watermark  timestamptz,
  updated_at timestamptz not null default now()
);
