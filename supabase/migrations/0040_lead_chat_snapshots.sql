-- Copia compacta del chat de los leads con carrito, para poder leerlos fuera
-- de Icomfly.
--
-- El tablero lee cada chat en vivo y nunca lo guarda. Para analizar los
-- carritos (a cual le falta poco para cerrar) hay que leer el texto de cada
-- conversacion, y eso solo se puede desde el servidor. La llena
-- /api/leads/chat-snapshots (se dispara a mano desde el navegador).
--
-- Una fila por lead, se sobreescribe en cada lectura: no crece. Son mensajes de
-- clientes: RLS activa SIN politicas, solo la lee el service role (igual que
-- cron_runs). Se puede vaciar cuando ya no haga falta.

create table if not exists public.lead_chat_snapshots (
  lead_id bigint primary key references public.leads(id) on delete cascade,
  store_id bigint not null,
  message_count integer not null default 0,
  messages jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists lead_chat_snapshots_store_idx on public.lead_chat_snapshots (store_id);

alter table public.lead_chat_snapshots enable row level security;
