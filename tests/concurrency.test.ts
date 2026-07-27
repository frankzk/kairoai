import { describe, expect, it } from "vitest";

import { forEachRateLimited, sleep } from "../lib/concurrency";

describe("forEachRateLimited", () => {
  it("procesa todos los items exactamente una vez", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const seen: number[] = [];
    await forEachRateLimited(
      items,
      async (item) => {
        seen.push(item);
      },
      { concurrency: 3, minIntervalMs: 1 }
    );
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("respeta el espaciado minimo entre arranques", async () => {
    const INTERVAL = 20;
    const starts: number[] = [];
    await forEachRateLimited(
      [1, 2, 3, 4, 5],
      async () => {
        starts.push(Date.now());
        // Latencia variable: no debe afectar la tasa de arranque.
        await sleep(30);
      },
      { concurrency: 5, minIntervalMs: INTERVAL }
    );
    for (let i = 1; i < starts.length; i++) {
      // Holgura de 5 ms por la granularidad de los timers.
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(INTERVAL - 5);
    }
  });

  it("nunca supera la concurrencia pedida", async () => {
    let inFlight = 0;
    let peak = 0;
    await forEachRateLimited(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleep(15);
        inFlight -= 1;
      },
      { concurrency: 4, minIntervalMs: 1 }
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("la latencia sale del camino critico (mas rapido que secuencial)", async () => {
    const LATENCY = 40;
    const INTERVAL = 10;
    const items = Array.from({ length: 6 }, (_, i) => i);
    const started = Date.now();
    await forEachRateLimited(items, async () => sleep(LATENCY), {
      concurrency: 4,
      minIntervalMs: INTERVAL,
    });
    const elapsed = Date.now() - started;
    // Secuencial costaria 6 * (10 + 40) = 300 ms; en paralelo debe rondar
    // 6*10 + 40 = 100 ms. Se exige holgadamente menos de 200 ms.
    expect(elapsed).toBeLessThan(200);
  });

  it("no rompe con lista vacia", async () => {
    let calls = 0;
    await forEachRateLimited(
      [],
      async () => {
        calls += 1;
      },
      { concurrency: 5, minIntervalMs: 10 }
    );
    expect(calls).toBe(0);
  });
});
