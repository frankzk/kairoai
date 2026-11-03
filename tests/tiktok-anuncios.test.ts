// TikTok por anuncio en la Matriz 4Pi (Charlie).
//
// POR QUE ESTE TEST EXISTE: la matriz compara anuncios de Meta y TikTok con el
// mismo detalle diario. Si TikTok llega duplicado, sin compras o con datos que
// no da (estado, post), la matriz recomendaria mal. Lo que TikTok no da queda
// vacio, no inventado.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cuentasCharlieTiktok, leerFilaAnuncio, type FilaAnuncio } from "../lib/tiktok-anuncios";

const guardado = new Map<string, Record<string, unknown>>();
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: () => ({
      upsert: async (filas: Array<Record<string, unknown>>) => {
        for (const f of filas) guardado.set(`${f.store_id}|${f.advertiser_id}|${f.ad_id}|${f.fecha}`, f);
        return { error: null };
      },
    }),
  }),
}));

const fila = (over: Record<string, unknown> = {}) => ({
  advertiser_id: "7557137680941973521",
  advertiser_name: "KENKU HEAL1010",
  ad_id: "1850000000000001",
  ad_name: "Lash 01",
  adgroup_id: "1840000000000001",
  adgroup_name: "Grupo A",
  campaign_id: "1859065142442017",
  campaign_name: "Magnetic Lash | Ventas",
  date: "2026-11-02T00:00:00.000Z",
  spend: "24.31",
  impressions: "7650",
  clicks: "119",
  frequency: "1.18",
  purchases: "4",
  value_per_purchase: "89.9",
  interactions: "35",
  currency: "PEN",
  ...over,
});

async function enviar(cuerpo: unknown, clave: string | null = "s3creto") {
  const { POST } = await import("../app/api/marketing/tiktok-anuncios/route");
  return POST(
    new NextRequest("http://localhost/api/marketing/tiktok-anuncios", {
      method: "POST",
      body: JSON.stringify(cuerpo),
      headers: clave ? { "x-kairo-secret": clave, "content-type": "application/json" } : {},
    })
  );
}

describe("filas por anuncio", () => {
  it("lee las metricas y calcula el valor de compras (compras x valor por compra)", () => {
    expect(leerFilaAnuncio(fila(), 1)).toEqual({
      ok: true,
      fila: expect.objectContaining({
        fecha: "2026-11-02",
        spend: 24.31,
        impressions: 7650,
        frequency: 1.18,
        purchases: 4,
        purchase_value: 359.6,
        interactions: 35,
        currency: "PEN",
      }),
    });
    expect(leerFilaAnuncio(fila({ purchases: "0", value_per_purchase: "" }), 1)).toMatchObject({
      ok: true,
      fila: { purchases: 0, purchase_value: null },
    });
    expect(leerFilaAnuncio(fila({ ad_id: "x" }), 1)).toMatchObject({ ok: false });
  });
});

describe("POST /api/marketing/tiktok-anuncios", () => {
  beforeEach(() => {
    guardado.clear();
    process.env.KAIRO_MAKE_SECRET = "s3creto";
  });

  it("con la clave guarda; el mismo dia reenviado reemplaza; vacio no es error", async () => {
    expect((await enviar({ store: "mireva-cr", rows: [fila()] }, "otra")).status).toBe(401);
    expect((await enviar({ store: "mireva-cr", rows: [fila({ spend: "10" })] })).status).toBe(200);
    expect((await enviar({ store: "mireva-cr", rows: [fila()] })).status).toBe(200);
    expect(guardado.size).toBe(1);
    expect(Array.from(guardado.values())[0]).toMatchObject({ spend: 24.31 });
    expect((await enviar({ store: "mireva-cr", rows: [] })).status).toBe(200);
  });
});

describe("cuenta de TikTok en Charlie", () => {
  const base: FilaAnuncio = {
    store_id: 1, advertiser_id: "1", advertiser_name: "KENKU HEAL1010", ad_id: "10", ad_name: "A", adgroup_id: "5",
    adgroup_name: "G", campaign_id: "9", campaign_name: "C", fecha: "2026-11-01", spend: 10, impressions: 100,
    clicks: 5, frequency: 1.2, purchases: 1, purchase_value: 50, interactions: 3, currency: "PEN",
  };

  it("anuncios con su detalle diario; activo solo si gasto el ultimo dia; sin post ni creativo", () => {
    const [cuenta] = cuentasCharlieTiktok(
      [base, { ...base, fecha: "2026-11-02", spend: 12 }, { ...base, ad_id: "11", ad_name: "B", spend: 4 }],
      "2026-11-02",
      ""
    );
    expect(cuenta).toMatchObject({ id: "1", name: "TikTok · KENKU HEAL1010", currency: "PEN" });
    const a = cuenta.ads.find((x) => x.id === "10")!;
    const b = cuenta.ads.find((x) => x.id === "11")!;
    expect(a).toMatchObject({ effectiveStatus: "ACTIVE", postId: null, creativeId: null, assets: null, adsetId: "5" });
    expect(a.daily.map((d) => [d.date, d.spend])).toEqual([["2026-11-01", 10], ["2026-11-02", 12]]);
    expect(b.effectiveStatus).toBe("SIN_DATO");
    expect(cuenta.adsets).toEqual([expect.objectContaining({ id: "5", effectiveStatus: "ACTIVE", dynamic: false })]);
  });

});
