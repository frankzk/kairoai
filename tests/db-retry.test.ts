// Que la aplicacion sobreviva a un reinicio de PostgREST.
//
// EL CASO REAL (03/09/2026): PostgREST se reinicio. Los logs muestran "Starting
// PostgREST 14.5" y, en el arranque, "connection refused" contra Postgres.
// Durante ese rato Cloudflare devolvia 521 y TODA la aplicacion se caia a la
// vez — incluido el tablero de Leads, que no tenia nada que ver con lo que
// disparo el problema.
//
// El reintento aguantaba 0,75 s. El reinicio duro entre 10 y 30. Por eso el
// error llego a la pantalla en vez de absorberse.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { READ_RETRY_BACKOFF_MS, supabaseFetchWithReadRetry } from "../lib/db";

/** Respuestas encoladas; cada llamada a fetch consume la siguiente. */
function fetchQueSirve(...respuestas: Array<number | Error>) {
  const llamadas: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    llamadas.push(String(init?.method ?? "GET"));
    const siguiente = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    if (siguiente instanceof Error) throw siguiente;
    return new Response("[]", { status: siguiente });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, llamadas };
}

beforeEach(() => {
  // Las esperas del backoff no se viven en tiempo real: se adelantan.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Corre la peticion adelantando el reloj. Sin esto el test esperaria los 31
 * segundos reales de la escalera de reintentos.
 */
async function conElRelojAdelantado(promesa: Promise<Response>): Promise<Response> {
  await vi.runAllTimersAsync();
  return promesa;
}

describe("presupuesto de reintento de lectura", () => {
  it("aguanta mas de 30 segundos, que es lo que tarda un reinicio", () => {
    const total = READ_RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0);
    // El valor viejo era 750 ms y se rendia antes de que PostgREST volviera.
    expect(total).toBeGreaterThan(30_000);
  });

  it("la escalera crece: no machaca al servicio que se esta levantando", () => {
    for (let i = 1; i < READ_RETRY_BACKOFF_MS.length; i++) {
      expect(READ_RETRY_BACKOFF_MS[i]).toBeGreaterThan(READ_RETRY_BACKOFF_MS[i - 1]);
    }
  });
});

describe("supabaseFetchWithReadRetry", () => {
  it("una lectura que pilla el reinicio termina bien cuando el servicio vuelve", async () => {
    // 503 tres veces (PostgREST reiniciando) y despues 200.
    const { fn } = fetchQueSirve(503, 503, 503, 200);
    const res = await conElRelojAdelantado(supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/leads"));
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("absorbe tambien el 521 de Cloudflare, que es lo que vio el navegador", async () => {
    const { fn } = fetchQueSirve(522, 200);
    const res = await conElRelojAdelantado(supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/leads"));
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("una ESCRITURA no se reintenta nunca: podria duplicar", async () => {
    // Un PATCH que devolvio 503 puede haberse aplicado igual del otro lado.
    const { fn } = fetchQueSirve(503, 200);
    const res = await conElRelojAdelantado(supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/incidents", {
      method: "PATCH",
    }));
    expect(res.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("un error del cliente (404) se devuelve tal cual, sin gastar reintentos", async () => {
    const { fn } = fetchQueSirve(404);
    const res = await conElRelojAdelantado(supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/nope"));
    expect(res.status).toBe(404);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("si el servicio no vuelve, se rinde y devuelve el ultimo error", async () => {
    const { fn } = fetchQueSirve(503);
    const res = await conElRelojAdelantado(supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/leads"));
    expect(res.status).toBe(503);
    // Un intento inicial mas un reintento por cada escalon.
    expect(fn).toHaveBeenCalledTimes(READ_RETRY_BACKOFF_MS.length + 1);
  });

  it("una conexion cortada tambien se reintenta", async () => {
    const { fn } = fetchQueSirve(new Error("ECONNRESET"), 200);
    const res = await conElRelojAdelantado(supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/leads"));
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
