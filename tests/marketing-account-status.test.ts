import { describe, expect, it } from "vitest";
import {
  accountStatusRows,
  appliedRates,
  appliedRateText,
  appliedRatesShortText,
  disableReasonText,
} from "../lib/marketing-account-status";
import type { UsdRate } from "../lib/marketing-charlie-types";
import type { MetaAccountStatus } from "../lib/marketing-insights-types";

const fx: UsdRate = {
  rate: 517.3,
  date: "2026-11-04",
  source: "hacienda",
  checkedAt: "2026-11-05T14:00:00Z",
  message: "",
  pen: { rate: 3.52, date: "2026-11-04", source: "bcrp" },
};

describe("appliedRates", () => {
  it("muestra la tasa aplicada, la referencia y la diferencia", () => {
    const { crc, pen } = appliedRates(fx);
    expect(crc).toMatchObject({ rate: 517.3, source: "hacienda", reference: 505 });
    expect(crc.driftPct).toBeCloseTo(2.4356, 3);
    expect(crc.drift).toBe(false);
    expect(pen).toMatchObject({ rate: 3.52, source: "bcrp", reference: 3.5 });
    expect(pen.driftPct).toBeCloseTo(0.5714, 3);
    expect(appliedRateText(crc)).toBe(
      "1 USD = 517,30 CRC (Hacienda, 4 nov) · referencia del equipo 505 (+2,4 %)",
    );
    expect(appliedRateText(pen)).toBe(
      "1 USD = 3,52 PEN (BCRP, 4 nov) · referencia del equipo 3,50 (+0,6 %)",
    );
    expect(appliedRatesShortText({ crc, pen })).toBe(
      "USD · 517,30 CRC/USD (Hacienda, 4 nov · equipo 505) · 3,52 PEN/USD (BCRP, 4 nov · equipo 3,50)",
    );
  });

  it("marca la diferencia grande y la tasa fija a mano", () => {
    const { crc, pen } = appliedRates({
      ...fx,
      rate: 530,
      source: "manual",
      pen: { rate: 3.5, date: "2026-11-05", source: "manual" },
    });
    expect(crc.source).toBe("manual");
    expect(crc.drift).toBe(true);
    expect(pen.source).toBe("manual");
    expect(pen.driftPct).toBe(0);
    expect(appliedRateText(pen)).toMatch(/fija a mano/);
  });

  it("sin tasa: no se inventa conversión", () => {
    const { crc, pen } = appliedRates({
      ...fx,
      rate: null,
      source: "unavailable",
      pen: null,
    });
    expect(crc).toMatchObject({ rate: null, source: "unavailable", driftPct: null, drift: false });
    expect(pen.rate).toBeNull();
    expect(appliedRateText(pen)).toMatch(/sin convertir/);
    expect(appliedRates(null).crc.source).toBe("unavailable");
  });
});

const account = (over: Partial<MetaAccountStatus>): MetaAccountStatus => ({
  accountId: "111",
  name: "Mireva CR4",
  state: "activa",
  statusCode: 1,
  disableReason: 0,
  currency: "USD",
  amountSpent: 100,
  spendCap: null,
  ...over,
});

describe("accountStatusRows", () => {
  const today = "2026-11-05";
  it("etiqueta CRn, límite de gasto al 92 % y cuenta restringida", () => {
    const { rows, problems } = accountStatusRows({
      meta: [
        account({ amountSpent: 920, spendCap: 1000 }),
        account({
          accountId: "222",
          name: "Mireva CR2",
          state: "deshabilitada",
          statusCode: 2,
          disableReason: 1,
        }),
        account({ accountId: "333", name: "Mireva CR3", amountSpent: 10, spendCap: 1000 }),
      ],
      metaError: false,
      tiktok: [],
      labels: [],
      today,
    });
    expect(rows.map((r) => r.label)).toEqual(["CR4", "CR2", "CR3"]);
    expect(rows[0]).toMatchObject({
      tone: "wait",
      title: "Límite de gasto casi alcanzado (92 %)",
      problem: true,
    });
    expect(rows[1]).toMatchObject({
      tone: "risk",
      title: "Restringida: Política de anuncios",
    });
    expect(rows[2]).toMatchObject({ tone: "good", problem: false });
    expect(problems).toHaveLength(2);
  });

  it("sin acceso es problema; un error de consulta no va al banner", () => {
    const { rows, problems } = accountStatusRows({
      meta: [
        account({ state: "sin_acceso", statusCode: null }),
        account({ accountId: "9", name: null, state: "error", statusCode: null }),
      ],
      metaError: false,
      tiktok: [],
      labels: [{ platform: "meta", account_id: "9", label: "Respaldo" }],
      today,
    });
    expect(rows[0].title).toBe(
      "Sin acceso: el token de Kairo no puede leer esta cuenta",
    );
    expect(rows[1].label).toBe("Respaldo");
    expect(rows[1].problem).toBe(false);
    expect(problems.map((p) => p.accountId)).toEqual(["111"]);
  });

  it("TikTok: al día hasta hoy − 2, atrasado antes", () => {
    const feed = (lastDate: string | null) => ({
      advertiserId: "7557",
      name: "Mireva TikTok",
      lastDate,
      updatedAt: "2026-11-05T14:47:08Z",
    });
    const ok = accountStatusRows({
      meta: null,
      metaError: false,
      tiktok: [feed("2026-11-03")],
      labels: [],
      today,
    });
    expect(ok.rows[0]).toMatchObject({
      label: "TikTok",
      tone: "good",
      title: "Datos hasta el 3 nov",
    });
    expect(ok.notes).toContain(
      "Make no envía el estado de la cuenta de TikTok; solo hasta qué día llegó el gasto.",
    );
    expect(ok.notes.join(" ")).toMatch(/Meta no está configurado/);
    const late = accountStatusRows({
      meta: null,
      metaError: true,
      tiktok: [feed("2026-11-02")],
      labels: [],
      today,
    });
    expect(late.rows[0]).toMatchObject({ title: "No se pudo consultar Meta", problem: false });
    expect(late.rows[1]).toMatchObject({
      tone: "risk",
      title: "Make no envía TikTok desde el 2 nov",
      problem: true,
    });
    expect(
      accountStatusRows({ meta: null, metaError: false, tiktok: [feed(null)], labels: [], today })
        .problems,
    ).toHaveLength(1);
  });

  it("motivo desconocido de Meta muestra el código", () => {
    expect(disableReasonText(99)).toBe("Motivo de Meta (código 99)");
    expect(disableReasonText(3)).toBe("Riesgo de pago");
  });

  it("pago pendiente y límite superado son riesgo", () => {
    const { rows } = accountStatusRows({
      meta: [
        account({ state: "pago_pendiente", statusCode: 3 }),
        account({ accountId: "2", amountSpent: 1000, spendCap: 1000 }),
      ],
      metaError: false,
      tiktok: [],
      labels: [],
      today,
    });
    expect(rows.map((r) => [r.tone, r.title])).toEqual([
      ["risk", "Pago pendiente"],
      ["risk", "Límite de gasto alcanzado (100 %)"],
    ]);
  });
});
