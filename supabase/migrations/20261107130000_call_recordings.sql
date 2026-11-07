-- Grabaciones de las llamadas guardadas en Kairo (07/11/2026).
--
-- QUÉ HACE: las grabaciones de Telnyx (TELNYX_GRABAR=1) y las viejas de
-- Zadarma se copian a un bucket PRIVADO nuestro, `call-recordings`, para
-- escucharlas desde el lead, el pedido (Gestión de pedidos) y la novedad. Los
-- enlaces de los proveedores vencen: los de Telnyx en ~10 minutos, los de
-- Zadarma a los 60 días. Lo copia el webhook de Telnyx al llegar
-- call.recording.saved y, lo que falte, el cron `call-recordings` (cada 15 min).
-- Ver lib/grabaciones.ts.
--
-- PIEZAS (en zadarma_calls, la tabla de llamadas de Zadarma y Telnyx):
--   - recording_id: id de la grabación en Telnyx (call.recording.saved); con él
--     se pide un enlace nuevo (GET /v2/recordings/{id}).
--   - recording_path: ruta del mp3 en el bucket (<tienda>/<yyyy>/<mm>/<id>.mp3).
--     Con valor = se puede escuchar.
--   - recording_saved_at: cuándo se copió.
--   - recording_error: por qué falló la última copia (corto, sin enlaces).
--   - recording_attempts: copias fallidas; al llegar a 6 (o con un error
--     definitivo, como un enlace vencido) el cron deja de intentar.
--   - order_name: el pedido por el que se llamó (desde Gestión de pedidos o
--     Novedades), para encontrar la llamada desde el pedido aunque el cliente
--     cambie de teléfono. Null en las llamadas desde Leads y en las viejas.
--   - Bucket `call-recordings`: privado, 50 MB por archivo, solo audio/mpeg.
--     Sin políticas para anon/authenticated: solo entra el service role (el
--     API), que verifica tienda y permiso y sirve URLs firmadas de 10 minutos.
--
-- Aditiva y re-ejecutable. Sin la migración la app sigue igual que antes: las
-- llamadas salen y se ven, solo sin "Escuchar" ni búsqueda por pedido, y el
-- cron responde ok sin hacer nada.

alter table public.zadarma_calls
  add column if not exists recording_id       text,
  add column if not exists recording_path     text,
  add column if not exists recording_saved_at timestamptz,
  add column if not exists recording_error    text,
  add column if not exists recording_attempts integer not null default 0,
  add column if not exists order_name         text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'zadarma_calls_recording_error_corto'
  ) then
    alter table public.zadarma_calls
      add constraint zadarma_calls_recording_error_corto
      check (recording_error is null or length(recording_error) <= 300);
  end if;
end $$;

comment on column public.zadarma_calls.recording_path is
  'Ruta del mp3 en el bucket privado call-recordings (<tienda>/<yyyy>/<mm>/<id>.mp3). Null = todavía no copiada.';
comment on column public.zadarma_calls.order_name is
  'Pedido por el que se llamó (Gestión de pedidos o Novedades). Null desde Leads.';

-- Llamadas de un pedido (historial de Gestión y Novedades).
create index if not exists zadarma_calls_store_order_idx
  on public.zadarma_calls (store_id, order_name, started_at desc)
  where order_name is not null;

-- Lo que el cron todavía tiene que copiar.
create index if not exists zadarma_calls_grabacion_pendiente_idx
  on public.zadarma_calls (provider, recording_attempts, started_at desc)
  where is_recorded and recording_path is null;

-- Bucket PRIVADO para los audios. Son conversaciones con clientes: no pueden
-- quedar accesibles por URL pública.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-recordings',
  'call-recordings',
  false,
  52428800, -- 50 MB: una llamada larga en mp3 pesa unos pocos MB
  array['audio/mpeg']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
