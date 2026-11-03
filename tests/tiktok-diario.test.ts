// Gasto de TikTok Ads que manda Make a Kairo.
//
// POR QUE ESTE TEST EXISTE: Make trae ayer y anteayer en cada corrida, asi que
// cada dia llega dos veces. Si se sumara, el gasto de TikTok saldria al doble
// en Marketing. Y la entrada es publica: sin la clave no se escribe nada.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cuentasTiktok, leerFilaTiktok, secretoValido, type FilaTiktok } from "../lib/tiktok-diario";
import { getMarketingSources } from "../lib/marketing-sources";

const guardado = new Map<string, Record<string, unknown>>();
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: () => ({
      upsert: async (filas: Array<Record<string, unknown>>) => {
        for (const f of filas) guardado.set(`${f.store_id}|${f.advertiser_id}|${f.campaign_id}|${f.fecha}`, f);
        return { error: null };
      },
    }),
  }),
}));

// Una fila como la arma el reporte de TikTok en Make.
const fila = (over: Record<string, unknown> = {}) => ({
  advertiser_id: "7557137680941973521",
  advertiser_name: "KENKU HEAL1010",
  campaign_id: "1859065142442017",
  campaign_name: "Magnetic Lash | Ventas",
  date: "2026-11-01T00:00:00.000Z",
  spend: "24.31",
  clicks: "119",
  conversions: "4",
  currency: "PEN",
  ...over,
});

async function enviar(cuerpo: unknown, clave: string | null = "s3creto") {
  const { POST } = await import("../app/api/marketing/tiktok-diario/route");
  return POST(
    new NextRequest("http://localhost/api/marketing/tiktok-diario", {
      method: "POST",
      body: JSON.stringify(cuerpo),
      headers: clave ? { "x-kairo-secret": clave, "content-type": "application/json" } : {},
    })
  );
}

describe("filas de Make", () => {
  it("lee la fecha de stat_time_day, montos en texto y la moneda", () => {
    const r = leerFilaTiktok(fila(), 1);
    expect(r).toEqual({
      ok: true,
      fila: expect.objectContaining({
        store_id: 1,
        fecha: "2026-11-01",
        spend: 24.31,
        clicks: 119,
        conversions: 4,
        impressions: null,
        currency: "PEN",
      }),
    });
  });

  it("rechaza lo que no se puede guardar sin inventar", () => {
    expect(leerFilaTiktok(fila({ campaign_id: "" }), 1)).toMatchObject({ ok: false });
    expect(leerFilaTiktok(fila({ date: "ayer" }), 1)).toMatchObject({ ok: false });
    expect(leerFilaTiktok(fila({ spend: "" }), 1)).toMatchObject({ ok: false });
    expect(leerFilaTiktok(fila({ currency: "" }), 1)).toMatchObject({ ok: false });
  });

  it("la clave se compara completa", () => {
    expect(secretoValido("abc", "abc")).toBe(true);
    expect(secretoValido("ab", "abc")).toBe(false);
    expect(secretoValido(null, "abc")).toBe(false);
    expect(secretoValido("abc", undefined)).toBe(false);
  });
});

describe("POST /api/marketing/tiktok-diario", () => {
  beforeEach(() => {
    guardado.clear();
    process.env.KAIRO_MAKE_SECRET = "s3creto";
  });

  it("sin la clave correcta no guarda nada", async () => {
    expect((await enviar({ store: "mireva-cr", ...fila() }, null)).status).toBe(401);
    expect((await enviar({ store: "mireva-cr", ...fila() }, "otra")).status).toBe(401);
    delete process.env.KAIRO_MAKE_SECRET;
    expect((await enviar({ store: "mireva-cr", ...fila() })).status).toBe(503);
    expect(guardado.size).toBe(0);
  });

  it("el mismo dia enviado dos veces queda una sola vez, con el ultimo monto", async () => {
    expect((await enviar({ store: "mireva-cr", ...fila({ spend: "20.00" }) })).status).toBe(200);
    expect((await enviar({ store: "mireva-cr", rows: [fila({ spend: "24.31" })] })).status).toBe(200);
    expect(guardado.size).toBe(1);
    expect(Array.from(guardado.values())[0]).toMatchObject({ spend: 24.31, store_id: 1 });
  });

  it("una tienda desconocida o una fila mala no se guarda", async () => {
    expect((await enviar({ store: "kenku-pe", ...fila() })).status).toBe(400);
    const r = await enviar({ store: "mireva-cr", rows: [fila(), fila({ spend: "x" })] });
    expect(r.status).toBe(400);
    expect(guardado.size).toBe(0);
  });
});

describe("Marketing con el gasto de Make", () => {
  const filas: FilaTiktok[] = [
    { store_id: 1, advertiser_id: "1", advertiser_name: "KENKU HEAL1010", campaign_id: "10", campaign_name: "A", fecha: "2026-11-01", spend: 10, clicks: 5, impressions: null, conversions: 1, currency: "PEN", timezone: "" },
    { store_id: 1, advertiser_id: "1", advertiser_name: "KENKU HEAL1010", campaign_id: "10", campaign_name: "A", fecha: "2026-11-02", spend: 15.5, clicks: 7, impressions: null, conversions: 2, currency: "PEN", timezone: "" },
    { store_id: 1, advertiser_id: "1", advertiser_name: "KENKU HEAL1010", campaign_id: "11", campaign_name: "B", fecha: "2026-11-02", spend: 40, clicks: 9, impressions: null, conversions: null, currency: "PEN", timezone: "" },
  ];

  it("una cuenta con sus campañas, suma por campaña y detalle diario", () => {
    const [cuenta] = cuentasTiktok(filas);
    expect(cuenta).toMatchObject({ accountId: "1", accountName: "KENKU HEAL1010", currency: "PEN" });
    expect(cuenta.campaigns.map((c) => [c.id, c.spend, c.clicks])).toEqual([
      ["11", 40, 9],
      ["10", 25.5, 12],
    ]);
    expect(cuenta.campaigns[1].daily?.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("sin API de TikTok usa lo de Make; sin filas en el periodo queda pendiente, no en cero", async () => {
    const leer = vi.fn(async () => cuentasTiktok(filas));
    const listo = await getMarketingSources({ from: "2026-11-01", to: "2026-11-02" }, {}, fetch, { tiktokDesdeMake: leer });
    expect(leer).toHaveBeenCalledWith("2026-11-01", "2026-11-02");
    expect(listo.tiktok).toMatchObject({ status: "ready", data: { accounts: [{ currency: "PEN" }] } });

    const vacio = await getMarketingSources({ from: "2026-11-01", to: "2026-11-02" }, {}, fetch, {
      tiktokDesdeMake: async () => [],
    });
    expect(vacio.tiktok).toMatchObject({ status: "pending", data: null });
  });
});
