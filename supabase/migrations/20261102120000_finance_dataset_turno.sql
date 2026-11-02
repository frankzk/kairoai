-- ============================================================
-- Kairo AI - Una reconstruccion del dataset de Gestion a la vez
--
-- El 02/11/2026 a las 15:52 UTC Postgres (2 GB) se reinicio por memoria: se
-- juntaron varias reconstrucciones completas del dataset (crons de Shopify,
-- iComfly, Moovin, Forza, WYN y "Actualizar Moovin", que reconstruia una vez
-- por cada lote de 50 guias). Cada una lee todos los pedidos, logistica,
-- tracking y liquidaciones (~70 s).
--
-- Turno global: una sola reconstruccion a la vez en toda la plataforma (fila
-- store_id = 0). Quien la pide mientras otra corre deja su tienda marcada como
-- pendiente y sigue; el cron finance-pendientes (cada 5 min) las hace despues.
-- El turno vence solo (p_segundos) por si la funcion que lo tenia muere.
--
-- Solo el service role (el servidor de Kairo) puede usar estas funciones.
-- Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_dataset_turno (
  store_id     BIGINT       PRIMARY KEY,          -- 0 = el turno global
  ocupado_hasta TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  pendiente    BOOLEAN      NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE finance_dataset_turno ENABLE ROW LEVEL SECURITY;
INSERT INTO finance_dataset_turno (store_id) VALUES (0) ON CONFLICT DO NOTHING;

-- true: el que llama tiene el turno y reconstruye. false: otra reconstruccion
-- esta en curso; la tienda queda pendiente.
CREATE OR REPLACE FUNCTION finance_dataset_tomar_turno(p_store BIGINT, p_segundos INT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tomado BOOLEAN;
BEGIN
  INSERT INTO finance_dataset_turno (store_id) VALUES (0), (p_store) ON CONFLICT DO NOTHING;
  UPDATE finance_dataset_turno
     SET ocupado_hasta = NOW() + make_interval(secs => p_segundos), updated_at = NOW()
   WHERE store_id = 0 AND ocupado_hasta < NOW()
  RETURNING TRUE INTO tomado;
  IF tomado THEN
    UPDATE finance_dataset_turno SET pendiente = FALSE, updated_at = NOW() WHERE store_id = p_store;
    RETURN TRUE;
  END IF;
  UPDATE finance_dataset_turno SET pendiente = TRUE, updated_at = NOW() WHERE store_id = p_store;
  RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION finance_dataset_soltar_turno()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE finance_dataset_turno SET ocupado_hasta = 'epoch', updated_at = NOW() WHERE store_id = 0;
$$;

-- Si la reconstruccion fallo, la tienda vuelve a quedar pendiente.
CREATE OR REPLACE FUNCTION finance_dataset_marcar_pendiente(p_store BIGINT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO finance_dataset_turno (store_id, pendiente) VALUES (p_store, TRUE)
  ON CONFLICT (store_id) DO UPDATE SET pendiente = TRUE, updated_at = NOW();
$$;

REVOKE ALL ON FUNCTION finance_dataset_tomar_turno(BIGINT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance_dataset_soltar_turno() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance_dataset_marcar_pendiente(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance_dataset_tomar_turno(BIGINT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION finance_dataset_soltar_turno() TO service_role;
GRANT EXECUTE ON FUNCTION finance_dataset_marcar_pendiente(BIGINT) TO service_role;
