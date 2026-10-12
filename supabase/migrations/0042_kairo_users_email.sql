-- Correo para entrar. Cada persona puede entrar con su usuario corto o con su
-- correo (el mismo con el que trabaja en Icomfly y Drive). Es opcional: quien
-- no tiene correo entra con el usuario.
--
-- Se guarda en minuscula, asi el ingreso no depende de como lo escriba.

alter table public.kairo_users add column if not exists email text;

alter table public.kairo_users drop constraint if exists kairo_users_email_formato;
alter table public.kairo_users add constraint kairo_users_email_formato
  check (email is null or (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- Un correo = una sola persona.
create unique index if not exists kairo_users_email_key on public.kairo_users (email) where email is not null;
