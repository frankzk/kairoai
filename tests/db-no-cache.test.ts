// Ninguna lectura de Supabase puede salir de la cache de datos de Next.js.
//
// EL CASO REAL (06/10/2026): la tira de salud decia "12 procesos atrasados, sin
// actualizar hace 5 h" mientras cron_runs tenia corridas de hace minutos. Next
// 14 guarda en su Data Cache los `fetch` GET del servidor (supabase-js lee asi)
// y en Vercel esa cache no vence nunca. `dynamic = "force-dynamic"` no lo
// evitaba: probado con la app compilada contra un Supabase falso, 3 llamadas a
// /api/health/crons hicieron 1 sola consulta y devolvieron la misma foto.

import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseFetchWithReadRetry } from "../lib/db";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

function espiarFetch() {
  const inits: Array<RequestInit | undefined> = [];
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    inits.push(init);
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  return inits;
}

describe("supabaseFetchWithReadRetry no usa la cache de Next", () => {
  it("una lectura sale con cache: no-store", async () => {
    const inits = espiarFetch();
    await supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/cron_runs?select=*");
    expect(inits[0]?.cache).toBe("no-store");
  });

  it("aunque supabase-js no mande init, o mande otro valor", async () => {
    const inits = espiarFetch();
    await supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/cron_runs", { cache: "force-cache" });
    expect(inits[0]?.cache).toBe("no-store");
  });

  it("conserva lo demas que manda supabase-js (metodo, headers, body)", async () => {
    const inits = espiarFetch();
    await supabaseFetchWithReadRetry("https://x.supabase.co/rest/v1/leads", {
      method: "POST",
      headers: { apikey: "k" },
      body: "{}",
    });
    expect(inits[0]).toMatchObject({ method: "POST", headers: { apikey: "k" }, body: "{}", cache: "no-store" });
  });
});
