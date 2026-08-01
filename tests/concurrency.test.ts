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

  it("la latencia sale del camino critico: las consultas se solapan", async () => {
    // Se mide el SOLAPAMIENTO, no el reloj: afirmar "tardo menos de X ms"
    // depende de la carga de la maquina y produce tests intermitentes.
    // Con latencia (40 ms) mayor al espaciado (10 ms), el patron viejo
    // ("dormir y despues consultar") daba siempre 1 en vuelo; el nuevo debe
    // solapar varias.
    let inFlight = 0;
    let peak = 0;
    await forEachRateLimited(
      Array.from({ length: 6 }, (_, i) => i),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleep(40);
        inFlight -= 1;
      },
      { concurrency: 4, minIntervalMs: 10 }
    );
    expect(peak).toBeGreaterThan(1);
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
