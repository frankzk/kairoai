-- Doble check del cobro de una liquidacion, y la perdida por tipo de cambio.
--
-- EL PROBLEMA: `settlement_imports.total_to_liquidate` es lo que Boxful DICE que
-- va a pagar, en colones. La plata llega a Mercury en DOLARES. Entre esas dos
-- cifras hay una conversion que no se registraba en ninguna parte, asi que
-- nadie comprobaba que el monto llegara completo y la perdida por tipo de
-- cambio era invisible: no figuraba como gasto, simplemente entraban menos
-- dolares de los que hubieran entrado a tasa de mercado.
--
-- Historico en juego: 20 liquidaciones y ~104 millones de colones.

alter table settlement_imports
  -- Lo que efectivamente entro a Mercury.
  add column if not exists received_usd numeric,
  add column if not exists received_at date,
  -- Tasa de mercado del dia en que entro (moneda local por 1 USD). Es el punto
  -- de comparacion; sin ella se sabe el tipo de cambio aplicado pero no si fue
  -- bueno o malo. Se guarda POR LIQUIDACION y no se recalcula: la tasa de hoy
  -- no sirve para juzgar un cobro de hace un mes, y el proveedor gratuito que
  -- usa /api/finance/exchange-rate no da historicos.
  add column if not exists reference_rate numeric,
  -- Ruta del comprobante en el bucket `settlement-receipts`.
  add column if not exists receipt_path text,
  add column if not exists received_note text,
  -- Quien lo confirmo. Es plata: importa que quede el rastro.
  add column if not exists received_by text,
  add column if not exists received_recorded_at timestamptz;

-- Solo montos positivos: un cero o un negativo aca es un dato mal tecleado, y
-- `checkReceipt` los trata como "sin registrar" — mejor no dejarlos entrar.
alter table settlement_imports
  drop constraint if exists settlement_imports_received_usd_positivo;
alter table settlement_imports
  add constraint settlement_imports_received_usd_positivo
  check (received_usd is null or received_usd > 0);

alter table settlement_imports
  drop constraint if exists settlement_imports_reference_rate_positivo;
alter table settlement_imports
  add constraint settlement_imports_reference_rate_positivo
  check (reference_rate is null or reference_rate > 0);

comment on column settlement_imports.received_usd is
  'Dolares que entraron de verdad a Mercury por esta liquidacion.';
comment on column settlement_imports.reference_rate is
  'Tasa de mercado (moneda local por 1 USD) del dia del cobro. Punto de comparacion para medir el spread.';

-- Bucket PRIVADO para los comprobantes. Son capturas de movimientos bancarios:
-- no pueden quedar accesibles por URL. Se sirven con URL firmada de corta vida
-- desde el API, que ya valida la tienda.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'settlement-receipts',
  'settlement-receipts',
  false,
  5242880, -- 5 MB: es una captura de pantalla, no un video
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Sin politicas para anon/authenticated a proposito: al bucket solo entra el
-- service role, que es con lo que corre el API. El aislamiento por tienda se
-- impone en el API igual que en el resto del repo (no hay RLS en este proyecto).
