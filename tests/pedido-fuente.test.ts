import { describe, expect, it } from "vitest";
import { fuenteDePedido } from "@/lib/pedido-fuente";
import { buildPanelSeries } from "@/lib/panel-serie";

describe("fuente del pedido", () => {
  it("clasifica web, WhatsApp, Leads y manual como los guarda iComfly", () => {
    expect(fuenteDePedido({ orderNumber: "#1793491500244484348" })).toBe("web");
    expect(fuenteDePedido({ orderNumber: "SHOP-MVZQH6ZJ-K8QR" })).toBe("web");
    expect(fuenteDePedido({ orderNumber: "100048", salesChannel: "whatsapp" })).toBe("whatsapp");
    expect(fuenteDePedido({ orderNumber: "MANUAL-1-ABCDE", creo: "Conector IA" })).toBe("leads");
    expect(fuenteDePedido({ orderNumber: "MANUAL-1-ABCDE", creo: "Jeanny Linares" })).toBe("manual");
    expect(fuenteDePedido({ orderNumber: "99603" })).toBe("manual");
  });

  it("la serie reparte los generados de cada día por fuente", () => {
    const tz = "America/Costa_Rica";
    const start = Date.parse("2026-11-10T06:00:00Z");
    const rows = [
      { shopify_created_at: "2026-11-10T15:00:00Z", f: "web" as const },
      { shopify_created_at: "2026-11-10T16:00:00Z", f: "whatsapp" as const },
      { shopify_created_at: "2026-11-11T16:00:00Z", f: "leads" as const },
    ];
    const metrics = { generated: 1, confirmed: 0, dispatched: 0, delivered: 0, annulled: 0, ticket: 0 };
    const s = buildPanelSeries(rows, { curStart: start, curEnd: start + 2 * 86_400_000, prevStart: null, prevEnd: null }, tz, () => metrics, (r) => r.f);
    expect(s.days[0].sources).toEqual({ web: 1, whatsapp: 1, leads: 0, manual: 0 });
    expect(s.days[1].sources).toEqual({ web: 0, whatsapp: 0, leads: 1, manual: 0 });
    const sinFuente = buildPanelSeries(rows, { curStart: start, curEnd: start + 86_400_000, prevStart: null, prevEnd: null }, tz, () => metrics);
    expect(sinFuente.days[0].sources).toBeUndefined();
  });
});
