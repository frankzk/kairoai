-- Planilla quincenal (14/11/2026): del monto a pagar a cada persona hasta el
-- total abonado, con trazabilidad completa.
--
-- - payroll_staff gana su salario base por quincena, la moneda y como se le
--   paga (SINPE, transferencia...) con la cuenta.
-- - payroll_periods: una quincena por tienda (1 = del 1 al 15, 2 = del 16 a
--   fin de mes). Abierta se puede editar; cerrada queda fija.
-- - payroll_lines: una persona dentro de la quincena con su base del momento
--   (copia: cambiar el salario despues no reescribe quincenas pasadas).
-- - payroll_adjustments: extras, bonos y comisiones suman; rebajos y CCSS
--   restan. Total a pagar = base + sumas - restas.
-- - payroll_payments: los abonos (puede haber varios: adelanto y pago final).
--   Nunca se borran: se anulan con motivo. Cada abono crea su gasto de
--   planilla en business_expenses (expense_id) para la utilidad del mes; al
--   anularlo se borra ese gasto. La planilla se paga en soles: el abono guarda
--   el monto en la moneda de la persona y el tipo de cambio, y el gasto va en
--   colones con la nota "Monto original" que ya usa Gastos.
-- - payroll_events: bitacora de solo agregar (quien hizo que y cuando).
--
-- Solo service role (RLS activa sin politicas). Aditiva y re-ejecutable.

alter table public.payroll_staff
  add column if not exists salario_quincenal numeric(14,2) not null default 0,
  add column if not exists moneda text not null default 'PEN',
  add column if not exists metodo_pago text not null default '',
  add column if not exists cuenta_pago text not null default '';

create table if not exists public.payroll_periods (
  id          bigserial primary key,
  store_id    bigint not null,
  period_key  text not null,          -- 'YYYY-MM-1' o 'YYYY-MM-2'
  starts_on   date not null,
  ends_on     date not null,
  status      text not null default 'abierta' check (status in ('abierta', 'cerrada')),
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  closed_by   text,
  closed_at   timestamptz,
  unique (store_id, period_key)
);

create table if not exists public.payroll_lines (
  id          bigserial primary key,
  period_id   bigint not null references public.payroll_periods(id) on delete cascade,
  staff_id    bigint not null references public.payroll_staff(id),
  staff_name  text not null,
  staff_role  text not null default '',
  base        numeric(14,2) not null default 0 check (base >= 0),
  moneda      text not null default 'PEN',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (period_id, staff_id)
);
create index if not exists payroll_lines_period_idx on public.payroll_lines (period_id);

create table if not exists public.payroll_adjustments (
  id          bigserial primary key,
  line_id     bigint not null references public.payroll_lines(id) on delete cascade,
  kind        text not null check (kind in ('extra', 'bono', 'comision', 'otro_suma', 'rebajo', 'ccss', 'otro_resta')),
  amount      numeric(14,2) not null check (amount > 0),
  description text not null default '',
  created_by  text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists payroll_adjustments_line_idx on public.payroll_adjustments (line_id);

create table if not exists public.payroll_payments (
  id          bigserial primary key,
  line_id     bigint not null references public.payroll_lines(id) on delete restrict,
  amount      numeric(14,2) not null check (amount > 0),  -- en la moneda de la persona
  exchange_rate numeric(14,4),                          -- moneda -> CRC (null si es CRC)
  amount_crc  numeric(14,2) not null,                   -- lo que va al gasto (utilidad en colones)
  paid_on     date not null,
  method      text not null default '',
  reference   text not null default '',
  note        text not null default '',
  expense_id  bigint references public.business_expenses(id) on delete set null,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   text,
  void_reason text
);
create index if not exists payroll_payments_line_idx on public.payroll_payments (line_id);

create table if not exists public.payroll_events (
  id          bigserial primary key,
  period_id   bigint not null references public.payroll_periods(id) on delete cascade,
  line_id     bigint,
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  actor       text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists payroll_events_period_idx on public.payroll_events (period_id, created_at desc);

alter table public.payroll_periods enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_payments enable row level security;
alter table public.payroll_events enable row level security;

comment on table public.payroll_periods is 'Quincenas de planilla por tienda (Gestión › Planilla).';
comment on table public.payroll_payments is 'Abonos de planilla. No se borran: se anulan (voided_at). expense_id = su gasto de planilla.';
comment on table public.payroll_events is 'Bitácora de la planilla: solo se agregan filas.';
