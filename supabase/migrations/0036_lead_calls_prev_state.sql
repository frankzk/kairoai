-- Deshacer la ultima gestion de un lead.
--
-- "Resultado de la llamada" es la unica accion destructiva del tablero y se
-- dispara con UN clic, sin confirmar: seis botones rapidos pegados y un
-- desplegable de 19 estados que escribe con `onChange` —o sea, navegar con las
-- flechas del teclado ya compromete el estado, incluido `lista_negra`—. Ademas
-- agenda una fecha de recontacto. Un clic equivocado reescribia siete campos
-- del lead sin forma de volver.
--
-- Deshacer necesita saber que habia antes, y eso no estaba en ningun lado: el
-- historial guardaba el estado NUEVO (`new_status`) y nada del viejo.
--
-- `prev_state` guarda exactamente los campos que `applyDisposition`
-- sobreescribe: status, category, status_source, auto_reason, needs_attention,
-- closed_by, next_followup_at. Ni uno mas —no es una copia del lead— ni uno
-- menos.
--
-- Es JSONB y no columnas sueltas a proposito: es una instantanea opaca que
-- solo se escribe y se lee completa. No se filtra ni se agrega por ella, asi
-- que no lleva indice.
--
-- Las filas viejas quedan en NULL: son gestiones anteriores a esto y no se
-- pueden deshacer. El codigo lo trata como "no hay nada que revertir", no como
-- un error.
ALTER TABLE lead_calls ADD COLUMN IF NOT EXISTS prev_state JSONB;

COMMENT ON COLUMN lead_calls.prev_state IS
  'Instantanea de los campos del lead ANTES de esta gestion, para Deshacer. NULL = no se puede revertir.';
