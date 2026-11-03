// Tipo de cambio de soles (TikTok Costa Rica cobra en PEN) para el CPA combinado.
//
// POR QUE ESTE TEST EXISTE: sin convertir PEN a USD, Charlie no puede sumar
// TikTok con Meta y el CPA combinado queda "Sin datos". Y una tasa vieja o mal
// leida convertiria mal todo el gasto: mejor sin convertir que inventado.

import { describe, expect, it } from "vitest";
import { asUsd, fechaBcrp, getMarketingPenRate, jsonBcrp, ultimoTipoBcrp } from "../lib/marketing-usd-rate";

// Respuesta real del BCRP (serie PD04640PD), los dias sin dato vienen "n.d.".
const BCRP = {
  config: { title: "Tipo de cambio", series: [{ name: "Tipo de cambio - TC Sistema bancario SBS (S/ por US$) - Venta", dec: "3" }] },
  periods: [
    { name: "29.Oct.26", values: ["3.461"] },
    { name: "30.Oct.26", values: ["3.467"] },
    { name: "02.Nov.26", values: ["n.d."] },
    { name: "03.Nov.26", values: ["n.d."] },
  ],
};

describe("tipo de cambio PEN del BCRP", () => {
  it("lee el ultimo dia publicado y salta los 'n.d.'", () => {
    expect(fechaBcrp("30.Oct.26")).toBe("2026-10-30");
    expect(fechaBcrp("05.Set.26")).toBe("2026-09-05");
    expect(fechaBcrp("raro")).toBeNull();
    expect(ultimoTipoBcrp(BCRP)).toEqual({ rate: 3.467, date: "2026-10-30" });
    expect(ultimoTipoBcrp({ periods: [{ name: "02.Nov.26", values: ["n.d."] }] })).toBeNull();
  });

  it("lee el JSON aunque el BCRP le pegue un aviso de PHP al final (03/11/2026)", async () => {
    const conAviso = `${JSON.stringify(BCRP)}<br />\n<font size='1'><table class='xdebug-error xe-notice'>( ! ) Notice: Undefined offset: 1</table></font>`;
    expect(ultimoTipoBcrp(jsonBcrp(conAviso))).toEqual({ rate: 3.467, date: "2026-10-30" });
    expect(jsonBcrp("<html>caido</html>")).toBeNull();
    const fetcher = (async () => new Response(conAviso, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    expect(await getMarketingPenRate(fetcher, new Date("2026-11-03T15:00:00Z"), false)).toMatchObject({ rate: 3.467 });
  });

  it("consulta el BCRP; con una tasa de hace mas de 7 dias no convierte", async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(BCRP), { status: 200 });
    }) as unknown as typeof fetch;
    const pen = await getMarketingPenRate(fetcher, new Date("2026-11-03T15:00:00Z"), false);
    expect(pen).toEqual({ rate: 3.467, date: "2026-10-30", source: "bcrp" });
    expect(urls[0]).toContain("/PD04640PD/json/");
    expect(await getMarketingPenRate(fetcher, new Date("2026-11-20T15:00:00Z"), false)).toBeNull();
    const caido = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await getMarketingPenRate(caido, new Date("2026-11-03T15:00:00Z"), false)).toBeNull();
  });

  it("convierte PEN a USD solo con tasa verificada", () => {
    const fx = { rate: 507, date: "2026-11-03", source: "hacienda" as const, checkedAt: "", message: "", pen: { rate: 3.5, date: "2026-10-30", source: "bcrp" as const } };
    expect(asUsd(350, "PEN", fx)).toBe(100);
    expect(asUsd(5070, "CRC", fx)).toBe(10);
    expect(asUsd(350, "PEN", { ...fx, pen: null })).toBeNull();
  });
});
