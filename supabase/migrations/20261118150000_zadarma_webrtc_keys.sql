-- Llave WebRTC de cada extensión de Zadarma, compartida entre todas las
-- instancias de Kairo. Antes cada página abierta (y cada reintento cada 15 s)
-- le pedía la llave a la API de Zadarma, y el 18/11/2026 Zadarma frenó a Kairo
-- con "You exceeded the rate limit by IP". La llave dura ~72 h en Zadarma; se
-- guarda 48 h. `bloqueado_hasta` evita volver a preguntar mientras Zadarma
-- rechaza (límite o "Not authorized").
--
-- Solo service role (RLS activa sin políticas). Re-ejecutable.

create table if not exists public.zadarma_webrtc_keys (
  sip              text primary key check (length(sip) <= 64),
  key              text,
  expires_at       timestamptz,
  bloqueado_hasta  timestamptz,
  ultimo_error     text check (ultimo_error is null or length(ultimo_error) <= 300),
  updated_at       timestamptz not null default now()
);

alter table public.zadarma_webrtc_keys enable row level security;
