import { describe, expect, it } from "vitest";
import { highCpaAlerts, stockDaysRows } from "../lib/marketing-report-alerts";
import { coverageOf } from "../lib/marketing-coverage";
import type { CampaignActionRow, Window } from "../lib/marketing-actions";
import type { productComparison } from "../lib/marketing-team-report";

const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/[\u00a0\u202f]/g, " "));
type Comparison = ReturnType<typeof productComparison>[number];

const product = (name: string, available: number | null, units: number) => ({
  name,
  coverage: coverageOf(available, units),
});

describe("stock en días", () => {
  it("lists red and yellow products by days, and everything with known stock on demand", () => {
    const products = [
      product("Cápsulas", 100, 6), // 116 días
      product("Her Loss", 100, 117), // 6 días, amarillo
      product("Gomitas", 5, 14), // 2,5 días, rojo
      product("Sin stock cargado", null, 10),
      product("Sin ventas", 40, 0),
    ];
    expect(stockDaysRows(products).map((p) => p.name)).toEqual([
      "Gomitas",
      "Her Loss",
    ]);
    expect(stockDaysRows(products, true).map((p) => p.name)).toEqual([
      "Gomitas",
      "Her Loss",
      "Cápsulas",
      "Sin ventas",
    ]);
  });
});

const w = (patch: Partial<Window> = {}): Window => ({
  spendNative: null,
  spendUsd: null,
  pixel: null,
  real: null,
  utm: 0,
  partial: false,
  cpaReal: null,
  cpaPixel: null,
  ...patch,
});
const row = (patch: Partial<CampaignActionRow>): CampaignActionRow =>
  ({
    key: "meta:1:9",
    platform: "meta",
    accountLabel: "CR2",
    name: "CBO NAD+ MEN | CR",
    product: { key: "family:nad", name: "NAD+", automatic: true, reason: "" },
    days3: w(),
    days7: w(),
    ...patch,
  }) as CampaignActionRow;
const comparison = (
  name: string,
  value: number | null,
  sevenDayReal: number,
  partial = false,
  spend = value == null ? null : value * sevenDayReal,
): Comparison =>
  ({
    key: `family:${name.toLowerCase()}`,
    name,
    sevenDayReal,
    costs: [{}, {}, { value, partial, reason: "", spend }],
  }) as unknown as Comparison;

describe("CPA por encima del objetivo, con pedidos reales", () => {
  it("lists products over the target CPA with their real orders and the pixel aside", () => {
    const alerts = plain(
      highCpaAlerts(
        [
          comparison("NAD", 11.2, 12),
          comparison("Magnesium", 7.9, 10),
          comparison("Parcial", 15, 10, true),
          comparison("Poco gasto", 12, 1),
        ],
        [row({ days7: w({ spendUsd: 134.4, pixel: 22 }) })],
      ),
    );
    expect(alerts.products).toEqual([
      {
        key: "product:family:nad",
        title: "NAD",
        detail: "CPA real 7 días USD 11,20 (12 pedidos reales)",
        pixel: "píxel USD 6,11",
      },
    ]);
  });
  it("puts spend without real orders first, for products and campaigns", () => {
    const alerts = plain(
      highCpaAlerts(
        [
          comparison("NAD", 11.2, 12),
          comparison("Sin ventas", null, 0, false, 95),
          comparison("Sin gasto", null, 0, false, 0),
        ],
        [
          row({
            days3: w({ spendUsd: 60, real: 5, utm: 2, cpaReal: 12 }),
          }),
          row({ key: "zero", days3: w({ spendUsd: 180, real: 0 }) }),
          row({ key: "tiny", days3: w({ spendUsd: 4, real: 0 }) }),
        ],
      ),
    );
    expect(alerts.products.map((a) => a.detail)).toEqual([
      "Sin pedidos reales en 7 días con USD 95,00 de gasto",
      "CPA real 7 días USD 11,20 (12 pedidos reales)",
    ]);
    expect(alerts.campaigns.map((a) => a.key)).toEqual([
      "campaign:zero",
      "campaign:meta:1:9",
    ]);
    expect(alerts.campaigns[0].detail).toBe(
      "Sin pedidos reales en 3 días con USD 180,00 de gasto",
    );
  });
  it("lists campaigns whose 3-day real CPA is over the target, marked as estimate", () => {
    const alerts = plain(
      highCpaAlerts(
        [],
        [
          row({
            days3: w({ spendUsd: 60, real: 5, utm: 2, cpaReal: 12, pixel: 0 }),
          }),
          row({
            key: "b",
            days3: w({ spendUsd: 30, real: 4, utm: 4, cpaReal: 7.5 }),
          }),
        ],
      ),
    );
    expect(alerts.campaigns).toEqual([
      {
        key: "campaign:meta:1:9",
        title: "CBO NAD+ MEN | CR · CR2",
        detail: "CPA real 3 días USD 12,00 (estimado)",
        pixel: "píxel sin compras",
      },
    ]);
  });
});
