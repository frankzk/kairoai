-- Reparto automático de leads (09/11/2026): personas que NO reciben leads.
--
-- Hasta acá el reparto dejaba afuera a toda la supervisión (leads_equipo), y en
-- Costa Rica quien más vende también supervisa: la tienda se quedaba sin nadie
-- a quien repartir. Ahora reciben todas las personas con Leads salvo quien
-- administra configuración o usuarios, y en Configuración se puede sacar a
-- alguien puntual. Aditiva y re-ejecutable.
alter table public.lead_assignment_settings
  add column if not exists excluded_user_ids bigint[] not null default '{}';

comment on column public.lead_assignment_settings.excluded_user_ids is
  'kairo_users.id que no reciben leads en esta tienda aunque tengan acceso a Leads (Configuración).';
