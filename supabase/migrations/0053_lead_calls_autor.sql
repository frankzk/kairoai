-- Quien registro cada gestion de Leads (el USUARIO que estaba conectado).
--
-- `lead_calls.vendedora` dice a nombre de que asesora de la planilla quedo la
-- gestion, pero no quien la hizo: supervision (y antes cualquiera sin asesora
-- vinculada) elige la asesora en un selector que el navegador recuerda. El
-- 26-27/10/2026 una asesora nueva registro 39 gestiones a nombre de otra que ya
-- no estaba, porque su navegador tenia guardada a esa otra, y no habia forma de
-- probarlo desde la base: solo por coincidencia de horarios.
--
-- `kairo_user_id` es el usuario de `kairo_users` (NULL para el admin de la
-- contrasena compartida, que no tiene fila, y para crons y procesos del
-- sistema). `actor` es su nombre en ese momento, para que el historial se lea
-- aunque el usuario se borre o cambie de nombre.
--
-- Las filas viejas quedan en NULL: son anteriores a esto. Solo agrega columnas:
-- el codigo (`insertLeadCall`) sigue funcionando si esta migracion aun no se
-- aplico (reintenta sin estas columnas).
ALTER TABLE lead_calls ADD COLUMN IF NOT EXISTS kairo_user_id BIGINT
  REFERENCES public.kairo_users(id) ON DELETE SET NULL;
ALTER TABLE lead_calls ADD COLUMN IF NOT EXISTS actor TEXT;

CREATE INDEX IF NOT EXISTS lead_calls_kairo_user_idx
  ON lead_calls (kairo_user_id, occurred_at DESC)
  WHERE kairo_user_id IS NOT NULL;

COMMENT ON COLUMN lead_calls.kairo_user_id IS
  'Usuario de Kairo que registro la gestion. NULL = admin de contrasena compartida, sistema o fila anterior al 27/10/2026.';
COMMENT ON COLUMN lead_calls.actor IS
  'Nombre de quien registro la gestion en ese momento (usuario, "Administrador" o NULL si fue el sistema).';
