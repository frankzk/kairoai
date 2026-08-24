// La ventana hacia atras que usan los dos crons de refresco de Shopify.
//
// El cron rapido (shopify-recent, cada 10 min) mira 30 minutos atras y el
// profundo (shopify-refresh, cada 3 h) mira 14 dias. Si la ventana se calcula
// mal, un pedido nuevo se cae del refresco y hay que apretar "Sync Shopify" a
// mano, que es justo lo que esto vino a resolver.

import { describe, expect, it } from "vitest";
import { windowStart } from "../lib/shopify-refresh-run";

const AHORA = Date.parse("2026-08-24T16:00:00Z");

describe("windowStart", () => {
  it("resuelve la ventana en minutos del cron rapido", () => {
    expect(windowStart({ minutes: 30 }, AHORA)).toBe("2026-08-24T15:30:00.000Z");
  });

  it("resuelve la ventana en dias del cron profundo", () => {
    expect(windowStart({ days: 14 }, AHORA)).toBe("2026-08-10T16:00:00.000Z");
  });

  it("los minutos mandan sobre los dias cuando vienen los dos", () => {
    expect(windowStart({ minutes: 30, days: 14 }, AHORA)).toBe("2026-08-24T15:30:00.000Z");
  });

  it("cae a 14 dias con parametros vacios o invalidos", () => {
    const esperado = "2026-08-10T16:00:00.000Z";
    expect(windowStart({}, AHORA)).toBe(esperado);
    expect(windowStart({ minutes: 0, days: 0 }, AHORA)).toBe(esperado);
    expect(windowStart({ minutes: -5 }, AHORA)).toBe(esperado);
  });

  it("la ventana rapida cubre con holgura el intervalo de su cron", () => {
    // El cron corre cada 10 min y la ventana es de 30: si una corrida falla,
    // las dos siguientes todavia alcanzan lo que se perdio.
    const inicio = Date.parse(windowStart({ minutes: 30 }, AHORA));
    expect((AHORA - inicio) / 60_000).toBeGreaterThanOrEqual(3 * 10);
  });
});
