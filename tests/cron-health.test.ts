// La tira de salud de los crons: cuando avisa, cuando calla, y que el
// registro no se desincronice de vercel.json, de las carpetas y de la siembra.
//
// POR QUE ESTE TEST EXISTE: el aviso solo vale si no miente en ninguna de las
// dos direcciones. Si grita por un timeout suelto que se recupera solo, se
// aprende a ignorarlo. Si calla cuando un cron no corre, es el mismo silencio
// que habia antes — el de leads-inbound, apagado desde el 29/08 sin que nada
// lo dijera.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  CRON_JOBS,
  corridaOk,
  evaluateAll,
  evaluateCron,
  formatHace,
  isProblem,
  mensajeDeError,
  umbralMinutos,
  type CronJob,
  type CronRunRow,
} from "../lib/cron-jobs";
import { cronAccessAllowed } from "../lib/cron-auth";

const ROOT = path.resolve(__dirname, "..");
const AHORA = Date.parse("2026-10-04T18:00:00Z");
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();

const LEADS: CronJob = { name: "leads", label: "Leads de WhatsApp", everyMinutes: 5 };
const RECENT: CronJob = { name: "shopify-recent", label: "Pedidos nuevos de Shopify", everyMinutes: 10 };

function fila(over: Partial<CronRunRow> = {}): CronRunRow {
  return {
    name: "leads",
    registered_at: hace(60 * 24 * 30),
    last_started_at: hace(2),
    last_finished_at: hace(1),
    last_ok_at: hace(1),
    last_status: 200,
    last_duration_ms: 40_000,
    last_error: null,
    last_error_at: null,
    ...over,
  };
}

describe("evaluateCron: cuando avisa y cuando calla", () => {
  it("al dia: no avisa", () => {
    expect(evaluateCron(LEADS, fila(), AHORA).state).toBe("ok");
  });

  it("un timeout SUELTO que se recupera no prende la tira", () => {
    // shopify-recent se pasa del tiempo en ~3% de sus corridas. Una falla y
    // la siguiente anda: avisar por eso enseña a ignorar el aviso.
    const r = evaluateCron(
      RECENT,
      fila({ name: "shopify-recent", last_ok_at: hace(15), last_started_at: hace(12), last_finished_at: hace(15) }),
      AHORA
    );
    expect(r.state).toBe("ok");
  });

  it("dos intervalos sin una corrida buena: avisa con cuanto hace", () => {
    const r = evaluateCron(LEADS, fila({ last_ok_at: hace(47), last_finished_at: hace(47) }), AHORA);
    expect(r.state).toBe("atrasado");
    expect(r.reason).toContain("sin actualizar hace 47 min");
    expect(isProblem(r)).toBe(true);
  });

  it("el limite es el doble del intervalo mas 5 minutos", () => {
    expect(umbralMinutos(5)).toBe(15);
    expect(evaluateCron(LEADS, fila({ last_ok_at: hace(15) }), AHORA).state).toBe("ok");
    expect(evaluateCron(LEADS, fila({ last_ok_at: hace(16) }), AHORA).state).toBe("atrasado");
  });

  it("si la ultima corrida empezo y no termino, lo dice: es un timeout", () => {
    const r = evaluateCron(
      LEADS,
      fila({ last_ok_at: hace(60), last_finished_at: hace(60), last_started_at: hace(10) }),
      AHORA
    );
    expect(r.reason).toContain("no terminó (probable timeout)");
  });

  it("si la ultima corrida fallo, dice con que error", () => {
    const r = evaluateCron(
      LEADS,
      fila({
        last_ok_at: hace(60),
        last_started_at: hace(3),
        last_finished_at: hace(2),
        last_error: "Icomfly respondió 503",
        last_error_at: hace(2),
      }),
      AHORA
    );
    expect(r.reason).toContain("última falla: Icomfly respondió 503");
  });

  it("no repite un error viejo que ya se resolvio", () => {
    // Fallo hace dos horas, anduvo despues, y ahora esta atrasado por otra
    // razon: mostrar el error viejo seria mandar a buscar donde no es.
    const r = evaluateCron(
      LEADS,
      fila({
        last_ok_at: hace(60),
        last_finished_at: hace(60),
        last_started_at: hace(60),
        last_error: "error viejo",
        last_error_at: hace(120),
      }),
      AHORA
    );
    expect(r.reason).not.toContain("error viejo");
  });

  it("un proceso sin fila, pasado su plazo desde la instalacion: avisa (asi se perdio shopify-recent)", () => {
    // El registro se instalo hace 2 horas (primera fila de cualquier cron) y
    // leads —cada 5 min— no escribio nada: Vercel lo invoca y algo lo corta.
    const r = evaluateCron(LEADS, null, AHORA, AHORA - 120 * 60_000);
    expect(r.state).toBe("nunca");
    expect(isProblem(r)).toBe(true);
  });

  it("un proceso sin fila, todavia dentro de su plazo: espera, no acusa", () => {
    // El dia del deploy: un proceso de 12 horas no tuvo su primera corrida
    // todavia. Acusarlo seria la falsa alarma que enseña a ignorar la tira.
    const RECHECK = { name: "shopify-recheck-stale", label: "x", everyMinutes: 720 };
    const r = evaluateCron(RECHECK, null, AHORA, AHORA - 60 * 60_000);
    expect(r.state).toBe("esperando");
    expect(isProblem(r)).toBe(false);
  });

  it("sin ninguna fila de nadie (recien desplegado): espera", () => {
    const r = evaluateCron(LEADS, null, AHORA, null);
    expect(r.state).toBe("esperando");
    expect(isProblem(r)).toBe(false);
  });

  it("primera corrida en curso dentro de su plazo: espera", () => {
    const r = evaluateCron(
      LEADS,
      fila({ registered_at: hace(3), last_started_at: hace(3), last_finished_at: null, last_ok_at: null }),
      AHORA
    );
    expect(r.state).toBe("esperando");
  });

  it("ninguna corrida buena desde su primera, pasado su plazo: 'nunca terminó bien'", () => {
    const r = evaluateCron(
      LEADS,
      fila({
        registered_at: hace(30),
        last_started_at: hace(4),
        last_finished_at: hace(3),
        last_ok_at: null,
        last_error: "HTTP 500",
        last_error_at: hace(3),
      }),
      AHORA
    );
    expect(r.state).toBe("atrasado");
    expect(r.reason).toContain("nunca terminó bien");
    expect(r.reason).toContain("última falla: HTTP 500");
  });

  it("evaluateAll toma como instalacion la fila MAS vieja de cualquier proceso", () => {
    // Solo leads escribio, hace 2 h. moovin (cada 60 min) no escribio nunca:
    // paso su plazo de 125 min? No: 120 < 125, todavia espera.
    const filas = [fila({ name: "leads", registered_at: hace(120) })];
    const porNombre = new Map(evaluateAll(filas, AHORA).map((h) => [h.name, h]));
    expect(porNombre.get("leads")?.state).toBe("ok");
    expect(porNombre.get("moovin")?.state).toBe("esperando");
    // Y 10 minutos despues, si: ya es "nunca corrió".
    const despues = new Map(evaluateAll(filas, AHORA + 10 * 60_000).map((h) => [h.name, h]));
    expect(despues.get("moovin")?.state).toBe("nunca");
  });

  it("un proceso sin programar no es un problema aunque no corra", () => {
    const r = evaluateCron({ name: "leads-inbound", label: "x", everyMinutes: null }, null, AHORA);
    expect(r.state).toBe("manual");
    expect(isProblem(r)).toBe(false);
  });

  it("evaluateAll devuelve un estado por cada proceso registrado", () => {
    expect(evaluateAll([], AHORA)).toHaveLength(CRON_JOBS.length);
  });

  it("formatHace habla como una persona", () => {
    expect(formatHace(0.2)).toBe("1 min");
    expect(formatHace(47)).toBe("47 min");
    expect(formatHace(150)).toBe("3 h");
    expect(formatHace(60 * 24 * 36)).toBe("36 días");
  });
});

describe("corridaOk y mensajeDeError", () => {
  it("2xx es ok", () => {
    expect(corridaOk(200, { ok: true })).toBe(true);
    expect(corridaOk(200, null)).toBe(true);
  });
  it("200 con ok: false NO es ok (WYN bloqueado responde asi)", () => {
    expect(corridaOk(200, { ok: false, blocked: true })).toBe(false);
    expect(mensajeDeError({ ok: false }, 200)).toBe("respondió ok: false");
  });
  it("un error HTTP no es ok, y se usa el mensaje del cuerpo", () => {
    expect(corridaOk(500, { error: "x" })).toBe(false);
    expect(mensajeDeError({ error: "Supabase 522" }, 500)).toBe("Supabase 522");
    expect(mensajeDeError(null, 500)).toBe("HTTP 500");
  });
  it("recorta un error larguisimo", () => {
    expect(mensajeDeError({ error: "x".repeat(5000) }, 500)).toHaveLength(300);
  });
});

describe("cronAccessAllowed: una sola puerta", () => {
  const SECRET = "s3cr3t";
  it("con sesion pasa siempre: los botones de la app no se rompen", () => {
    // El boton "Detectar" de Novedades llama a /api/cron/moovin con la cookie
    // y SIN el secreto. Si esto diera 401, SessionGuard manda al login.
    expect(cronAccessAllowed({ authenticated: true, authorization: null, secret: SECRET })).toBe(true);
  });
  it("sin sesion, solo con el secreto exacto", () => {
    expect(cronAccessAllowed({ authenticated: false, authorization: `Bearer ${SECRET}`, secret: SECRET })).toBe(true);
    expect(cronAccessAllowed({ authenticated: false, authorization: null, secret: SECRET })).toBe(false);
    expect(cronAccessAllowed({ authenticated: false, authorization: "Bearer otro", secret: SECRET })).toBe(false);
    expect(cronAccessAllowed({ authenticated: false, authorization: SECRET, secret: SECRET })).toBe(false);
  });
  it("sin secreto configurado se deja pasar (para no cortar los crons el dia del deploy)", () => {
    expect(cronAccessAllowed({ authenticated: false, authorization: null, secret: undefined })).toBe(true);
    expect(cronAccessAllowed({ authenticated: false, authorization: null, secret: "" })).toBe(true);
  });
});

// ── El registro no se puede desincronizar de nada ─────────────────────────

/** Minutos entre corridas de un horario de vercel.json (los formatos usados). */
function minutosEntre(schedule: string): number {
  const [min, hora, dia, mes, semana] = schedule.trim().split(/\s+/);
  if (dia !== "*" || mes !== "*" || semana !== "*") throw new Error(`horario no reconocido: ${schedule}`);
  let m: RegExpExecArray | null;
  if (hora === "*") {
    if ((m = /^\*\/(\d+)$/.exec(min))) return Number(m[1]);
    if (/^\d+$/.test(min)) return 60;
    if (/^\d+(,\d+)+$/.test(min)) return 60 / min.split(",").length;
  } else if (/^\d+$/.test(min)) {
    if ((m = /^\*\/(\d+)$/.exec(hora))) return Number(m[1]) * 60;
    if (/^\d+(,\d+)+$/.test(hora)) return 1440 / hora.split(",").length;
    if (/^\d+$/.test(hora)) return 1440;
  }
  throw new Error(`horario no reconocido: ${schedule}`);
}

function cronsDeVercel(): Array<{ name: string; every: number }> {
  const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  return (config.crons ?? []).map((c) => {
    const ruta = c.path.split("?")[0];
    expect(ruta.startsWith("/api/cron/"), `${ruta} no esta bajo /api/cron/`).toBe(true);
    return { name: ruta.slice("/api/cron/".length), every: minutosEntre(c.schedule) };
  });
}

describe("el registro coincide con vercel.json, las carpetas y la siembra", () => {
  const registrados = new Map(CRON_JOBS.map((j) => [j.name, j]));

  it("cada cron de vercel.json esta registrado con su mismo intervalo", () => {
    const vercel = cronsDeVercel();
    expect(vercel.length).toBeGreaterThan(5);
    for (const c of vercel) {
      const job = registrados.get(c.name);
      expect(job, `${c.name} esta en vercel.json pero no en CRON_JOBS: la tira nunca lo vigilaria`).toBeDefined();
      expect(job?.everyMinutes, `${c.name}: vercel.json dice cada ${c.every} min`).toBe(c.every);
    }
  });

  it("un proceso registrado con intervalo esta de verdad en vercel.json", () => {
    // Si no, la tira lo acusaria de atrasado para siempre.
    const enVercel = new Set(cronsDeVercel().map((c) => c.name));
    for (const job of CRON_JOBS.filter((j) => j.everyMinutes != null)) {
      expect(enVercel.has(job.name), `${job.name} tiene intervalo pero no esta programado`).toBe(true);
    }
  });

  it("cada carpeta de app/api/cron esta registrada, y viceversa", () => {
    const carpetas = readdirSync(path.join(ROOT, "app/api/cron")).filter((d) =>
      existsSync(path.join(ROOT, "app/api/cron", d, "route.ts"))
    );
    expect([...carpetas].sort()).toEqual(CRON_JOBS.map((j) => j.name).sort());
  });

  it("cada ruta de cron anota sus corridas con SU nombre, y no tiene su propia puerta", () => {
    for (const job of CRON_JOBS) {
      const src = readFileSync(path.join(ROOT, "app/api/cron", job.name, "route.ts"), "utf8");
      expect(src, `${job.name}: export sin envolver`).not.toMatch(/^export async function (GET|POST)/m);
      expect(src, `${job.name}: GET no anota`).toContain(`export const GET = withCronRun("${job.name}",`);
      for (const meth of ["GET", "POST"]) {
        const m = new RegExp(`export const ${meth} = withCronRun\\("([^"]+)"`).exec(src);
        if (m) expect(m[1], `${job.name}: ${meth} anota con otro nombre`).toBe(job.name);
      }
      // La puerta es el middleware. Un chequeo propio de CRON_SECRET aca
      // devolveria 401 a los botones de la app, y SessionGuard echa al login.
      expect(src, `${job.name}: tiene su propio chequeo de CRON_SECRET`).not.toContain("CRON_SECRET");
    }
  });

  it("ninguna ruta de cron se ejecuta durante el build", () => {
    // Next intenta pre-ejecutar los GET al compilar. Medido en main: tres
    // crons de Shopify ENTRABAN a ejecutarse en cada build (se salvaban
    // porque tocaban el request en la segunda linea y Next abandonaba). Con
    // withCronRun la primera linea escribe en la base: en Vercel, que tiene
    // credenciales durante el build, cada deploy habria anotado una falla
    // falsa. `force-dynamic` hace que nunca se pre-ejecuten.
    for (const job of CRON_JOBS) {
      const src = readFileSync(path.join(ROOT, "app/api/cron", job.name, "route.ts"), "utf8");
      expect(src, `${job.name}: falta force-dynamic`).toContain('export const dynamic = "force-dynamic";');
    }
  });

  it("la migracion NO siembra filas (sembrar daria falsa alarma el dia del deploy)", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0038_cron_runs.sql"), "utf8");
    expect(sql).not.toMatch(/INSERT INTO cron_runs/i);
  });
});
