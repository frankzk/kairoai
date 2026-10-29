alter table public.lead_icomfly_receipts
  add column if not exists expected_order jsonb;

comment on column public.lead_icomfly_receipts.expected_order is
  'Productos, variantes, cantidades y total esperados para verificar pedidos nativos de varias líneas. Null para intentos anteriores.';
