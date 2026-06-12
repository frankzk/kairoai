-- Catalogo de personal para planilla: la persona y su funcion se registran
-- una vez y los gastos de planilla las eligen de una lista.

CREATE TABLE IF NOT EXISTS payroll_staff (
  id          BIGSERIAL    PRIMARY KEY,
  name        TEXT         NOT NULL,
  role        TEXT         NOT NULL DEFAULT '',
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_staff_name_idx ON payroll_staff (lower(name));
