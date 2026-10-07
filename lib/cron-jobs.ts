// Que procesos automaticos tiene la app, cada cuanto tienen que correr, y si
// estan al dia. Sin base de datos: la lectura de `cron_runs` vive en
// lib/cron-runs.ts y aqui solo se decide.
//
// POR QUE EXISTE: hasta ahora, cuando un cron dejaba de funcionar, nadie se
// enteraba. Los tres cortes de septiembre los encontro el dueño mirando una
// pantalla rota. `leads-inbound` lleva apagado desde el 29/08 sin que nada lo
// dijera. Y la fuga de los telefonos +505 estuvo meses en un contador
// (`skipped_no_phone`) que nadie miraba. Esto es el aviso que faltaba.

export interface CronJob {
  /** Nombre de la carpeta en app/api/cron/. Es la llave en `cron_runs`. */
  name: string;
  /** Como se le dice en pantalla: lo que la persona reconoce, no la ruta. */
  label: string;
  /**
   * Cada cuantos minutos lo programa vercel.json. `null` = no esta programado
   * (solo se dispara a mano) y por lo tanto no puede estar "atrasado".
   * tests/cron-health.test.ts verifica que coincida con vercel.json.
   */
  everyMinutes: number | null;
}

export const CRON_JOBS: CronJob[] = [
  { name: "leads", label: "Leads de WhatsApp", everyMinutes: 5 },
  { name: "leads-reclassify", label: "Clasificación de leads", everyMinutes: 10 },
  { name: "leads-shopify-match", label: "Leads que ya compraron", everyMinutes: 60 },
  // Estuvo apagado del 29/08 al 07/10 (#217, en una caida de Supabase). En ese
  // tiempo 4.863 de 4.872 leads nuevos de Costa Rica quedaron sin conteo y el
  // tablero los mostraba a todos como "Solo saludó".
  { name: "leads-inbound", label: "Chat de los leads (Conversó)", everyMinutes: 10 },
  { name: "icomfly", label: "Pedidos de Icomfly", everyMinutes: 30 },
  { name: "shopify-recent", label: "Pedidos nuevos de Shopify", everyMinutes: 10 },
  { name: "shopify-refresh", label: "Guías de Shopify", everyMinutes: 180 },
  { name: "shopify-recheck-stale", label: "Pedidos viejos de Shopify", everyMinutes: 720 },
  { name: "finance-index", label: "Índice de Finanzas", everyMinutes: 60 },
  { name: "incidencias", label: "Novedades", everyMinutes: 60 },
  { name: "moovin", label: "Tracking Moovin", everyMinutes: 60 },
  { name: "forza", label: "Tracking Forza (Honduras)", everyMinutes: 60 },
  { name: "wyn", label: "Tracking WYN", everyMinutes: 30 },
  // Agente de voz Retell: sin llamadas desde el 25/08 y nunca programado.
  { name: "retries", label: "Reintentos del agente de voz", everyMinutes: null },
];

/** La fila de `cron_runs` (una por proceso, se sobreescribe en cada corrida). */
export interface CronRunRow {
  name: string;
  registered_at: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_ok_at: string | null;
  last_status: number | null;
  last_duration_ms: number | null;
  last_error: string | null;
  last_error_at: string | null;
}

/**
 * - ok: al dia.
 * - atrasado / nunca: merecen aviso.
 * - esperando: todavia dentro de su primer plazo desde que se instalo el
 *   registro; no se lo puede acusar de nada aun.
 * - manual: no esta programado, no puede atrasarse.
 */
export type CronState = "ok" | "atrasado" | "nunca" | "esperando" | "manual";

export interface CronHealth {
  name: string;
  label: string;
  state: CronState;
  /** Frase para la pantalla. `null` cuando no hay nada que decir. */
  reason: string | null;
  lastOkAt: string | null;
}

/** Margen sobre el doble del intervalo, para no gritar por un minuto de demora. */
export const GRACIA_MIN = 5;

/**
 * Cuanto puede pasar sin una corrida buena antes de avisar.
 *
 * El DOBLE del intervalo, y no el intervalo: una corrida que falla y la
 * siguiente que anda no es un problema, y avisar por eso enseña a ignorar el
 * aviso. Dos seguidas sin terminar bien, si. Con esto `shopify-recent` —que se
 * pasa del tiempo en ~3% de sus corridas— no prende la tira por un timeout
 * suelto, pero si por uno que se repite.
 */
export function umbralMinutos(everyMinutes: number): number {
  return everyMinutes * 2 + GRACIA_MIN;
}

/**
 * Una corrida que empezo y no termino en este tiempo la mato Vercel. El cron
 * mas largo tiene maxDuration de 300 s; seis minutos dejan margen.
 */
const NO_TERMINO_MS = 6 * 60_000;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function formatHace(minutos: number): string {
  if (minutos < 60) return `${Math.max(1, Math.round(minutos))} min`;
  const horas = minutos / 60;
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${Math.round(horas / 24)} días`;
}

/**
 * @param installMs Cuando empezo a funcionar el registro: la primera fila que
 *   escribio CUALQUIER cron (la de `leads`, a los 5 minutos del deploy). Es la
 *   referencia para un proceso que todavia no escribio nada. `null` = aun no
 *   anoto nadie (recien desplegado).
 */
export function evaluateCron(
  job: CronJob,
  row: CronRunRow | null,
  nowMs: number,
  installMs: number | null = null
): CronHealth {
  const base = { name: job.name, label: job.label, lastOkAt: row?.last_ok_at ?? null };

  if (job.everyMinutes == null) return { ...base, state: "manual", reason: null };
  const umbral = umbralMinutos(job.everyMinutes);

  // Sin fila: el proceso nunca llego a ejecutar el codigo. Es exactamente como
  // se perdio shopify-recent: Vercel lo invocaba, el middleware lo cortaba con
  // 401 y en la base no pasaba nada.
  //
  // Pero NO se lo acusa antes de que haya tenido su oportunidad: el registro
  // no se siembra a mano (sembrarlo con la hora de la migracion haria que un
  // merge horas despues prenda la tira en falso el primer dia). La referencia
  // es cuando empezo a anotar cualquier proceso.
  if (!row) {
    if (installMs == null || (nowMs - installMs) / 60_000 <= umbral) {
      return { ...base, state: "esperando", reason: null };
    }
    return { ...base, state: "nunca", reason: "nunca corrió" };
  }

  const okMs = ms(row.last_ok_at);
  // Sin ninguna corrida buena todavia: se cuenta desde su primera corrida.
  const referencia = okMs ?? ms(row.registered_at);
  if (referencia == null) return { ...base, state: "esperando", reason: null };

  const minutos = (nowMs - referencia) / 60_000;
  if (minutos <= umbral) return { ...base, state: okMs == null ? "esperando" : "ok", reason: null };

  const partes: string[] = [
    okMs == null ? "nunca terminó bien" : `sin actualizar hace ${formatHace(minutos)}`,
  ];

  const empezo = ms(row.last_started_at);
  const termino = ms(row.last_finished_at);
  const errorMs = ms(row.last_error_at);
  if (empezo != null && (termino == null || empezo > termino) && nowMs - empezo > NO_TERMINO_MS) {
    partes.push("la última corrida no terminó (probable timeout)");
  } else if (row.last_error && errorMs != null && (okMs == null || errorMs >= okMs)) {
    partes.push(`última falla: ${row.last_error}`);
  }

  return { ...base, state: "atrasado", reason: partes.join(" · ") };
}

export function evaluateAll(rows: CronRunRow[], nowMs: number): CronHealth[] {
  const porNombre = new Map(rows.map((r) => [r.name, r]));
  const registros = rows.map((r) => ms(r.registered_at)).filter((t): t is number => t != null);
  const installMs = registros.length ? Math.min(...registros) : null;
  return CRON_JOBS.map((job) => evaluateCron(job, porNombre.get(job.name) ?? null, nowMs, installMs));
}

/** Lo que merece un aviso en pantalla. */
export function isProblem(h: CronHealth): boolean {
  return h.state === "atrasado" || h.state === "nunca";
}

export const MAX_ERROR_CHARS = 300;

function campo(resumen: unknown, key: string): unknown {
  return resumen && typeof resumen === "object" && key in resumen
    ? (resumen as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Una corrida salio bien si el HTTP es 2xx Y el cuerpo no dice `ok: false`.
 *
 * Lo segundo importa: WYN responde 200 con `{ ok: false, blocked: ... }`
 * cuando el sitio lo bloquea. Mirando solo el status, un cron bloqueado todos
 * los dias se veria sano para siempre.
 */
export function corridaOk(status: number, resumen: unknown): boolean {
  return status >= 200 && status < 300 && campo(resumen, "ok") !== false;
}

export function mensajeDeError(resumen: unknown, status: number): string {
  const err = campo(resumen, "error");
  const texto =
    typeof err === "string" && err
      ? err
      : status >= 200 && status < 300
        ? "respondió ok: false"
        : `HTTP ${status}`;
  return texto.slice(0, MAX_ERROR_CHARS);
}
