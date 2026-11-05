-- Tasa manual de soles por dólar para TikTok (05/11/2026, módulo 11).
--
-- TikTok Costa Rica cobra en soles (PEN). Kairo convierte con la venta SBS
-- del BCRP; el equipo usa 3,50 como referencia. Igual que crc_per_usd, un
-- editor de Marketing puede fijar la tasa a mano (con su fecha) o volver a la
-- oficial dejando las dos columnas en null.

alter table public.marketing_charlie_config
  add column if not exists pen_per_usd numeric
    check (pen_per_usd is null or (pen_per_usd > 0 and pen_per_usd < 100)),
  add column if not exists pen_rate_date date;

comment on column public.marketing_charlie_config.pen_per_usd is 'Soles por dólar fijados a mano para convertir el gasto de TikTok; null = venta SBS del BCRP.';
comment on column public.marketing_charlie_config.pen_rate_date is 'Fecha de la tasa manual de soles por dólar; se usa solo si pen_per_usd también está.';
