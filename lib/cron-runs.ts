// Registro de cada corrida de cron en `cron_runs` (una fila por proceso, que
// se sobreescribe). Server-only.
//
// REGLA: anotar NUNCA puede romper el cron. Si la base no responde o la tabla
// no existe, se escribe un warning y el cron sigue exactamente igual que
// antes. El aviso es un extra; el trabajo del cron es lo que importa.

import { getDB } from "./db";
import { corridaOk, mensajeDeError, MAX_ERROR_CHARS, type CronRunRow } from "./cron-jobs";

const TABLE = "cron_runs";
/** Tope del resumen guardado: alcanza para los contadores, no para un dump. */
const MAX_SUMMARY_CHARS = 4000;

async function anotar(row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await getDB().from(TABLE).upsert(row, { onConflict: "name" });
    if (error) console.warn(`[cron-runs] no se pudo anotar ${String(row.name)}: ${error.message}`);
  } catch (err) {
    console.warn(`[cron-runs] no se pudo anotar ${String(row.name)}:`, err);
  }
}

async function leerResumen(res: Response): Promise<unknown> {
  try {
    const body = await res.clone().json();
    const texto = JSON.stringify(body);
    return texto.length <= MAX_SUMMARY_CHARS ? body : { truncado: true, bytes: texto.length };
  } catch {
    return null;
  }
}

/**
 * Envuelve el handler de un cron para dejar constancia de cada corrida.
 *
 * Anota el inicio ANTES de trabajar: si Vercel mata la funcion por timeout,
 * el final nunca se escribe, y "empezo pero no termino" es justo como se ve
 * un timeout desde afuera.
 */
export function withCronRun<A extends unknown[]>(
  name: string,
  handler: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    const inicio = Date.now();
    await anotar({ name, last_started_at: new Date(inicio).toISOString() });

    let res: Response;
    try {
      res = await handler(...args);
    } catch (err) {
      const fin = new Date().toISOString();
      await anotar({
        name,
        last_finished_at: fin,
        last_status: 500,
        last_duration_ms: Date.now() - inicio,
        last_error: (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS),
        last_error_at: fin,
      });
      throw err;
    }

    const fin = new Date().toISOString();
    const resumen = await leerResumen(res);
    await anotar({
      name,
      last_finished_at: fin,
      last_status: res.status,
      last_duration_ms: Date.now() - inicio,
      last_summary: resumen,
      ...(corridaOk(res.status, resumen)
        ? { last_ok_at: fin }
        : { last_error: mensajeDeError(resumen, res.status), last_error_at: fin }),
    });
    return res;
  };
}

export async function listCronRuns(): Promise<CronRunRow[]> {
  const { data, error } = await getDB()
    .from(TABLE)
    .select(
      "name, registered_at, last_started_at, last_finished_at, last_ok_at, last_status, last_duration_ms, last_error, last_error_at"
    );
  if (error) throw new Error(`listCronRuns: ${error.message}`);
  return (data ?? []) as CronRunRow[];
}
