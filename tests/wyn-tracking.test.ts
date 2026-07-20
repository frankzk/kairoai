import { describe, expect, it } from "vitest";
import {
  buildEnRouteGuides,
  getEffectiveTrackingStatus,
  type TrackableOrderRow,
  wynGroupToStatus,
} from "../lib/finance-orders";
import { FINANCE_STORES } from "../lib/store-config";
import {
  buildWynTrackingUrl,
  extractWynGuides,
  isWynGuide,
  normalizeWynGuide,
  normalizeWynStatus,
} from "../lib/wyn";

describe("WYN tracking", () => {
  it("reconoce y normaliza guias WYN de Costa Rica", () => {
    expect(normalizeWynGuide(" mlcr000051603sd ")).toBe("MLCR000051603SD");
    expect(isWynGuide("MLCR000051603SD")).toBe(true);
    expect(isWynGuide("2533332")).toBe(false);
    expect(buildWynTrackingUrl("mlcr000051603sd")).toBe(
      "https://wynexpress.com/tracking?number_id=MLCR000051603SD"
    );
  });

  it("extrae varias guias WYN sin duplicarlas", () => {
    expect(
      extractWynGuides("MLCR000051603SD / mlcr000051603sd; referencia MLCR000052000SD")
    ).toEqual(["MLCR000051603SD", "MLCR000052000SD"]);
  });

  it("prioriza devolucion aunque la descripcion tambien diga entregado", () => {
    expect(
      normalizeWynStatus("returned", "Devuelto", "Entregado en direccion de retorno")
    ).toBe("returned");
    expect(normalizeWynStatus("delivered", "Entregado", "Entrega completada")).toBe("delivered");
    expect(normalizeWynStatus("in_transit", "Ultima milla", "En manos del repartidor")).toBe(
      "en_route"
    );
    expect(
      normalizeWynStatus("exception", "En camino a entrega", "Domicilio de entrega incorrecto")
    ).toBe("incident");
  });

  it("traduce todos los estados WYN al seguimiento operativo", () => {
    expect(wynGroupToStatus("returned")).toBe("not_delivered");
    expect(wynGroupToStatus("not_delivered")).toBe("not_delivered");
    expect(wynGroupToStatus("incident")).toBe("incident");
    expect(wynGroupToStatus("en_route")).toBe("en_route");
  });

  it("da prioridad al estado WYN sobre una etiqueta historica de Moovin", () => {
    const base = {
      source: "shopify",
      boxful_status: "",
      internal_status: "matched",
      shopify_cancelled_at: null,
      shopify_financial_status: "pending",
      guide_number: "MLCR000051603SD",
      moovin_group: "in_progress",
      moovin_incidents: 0,
      forza_group: undefined,
      forza_incidents: 0,
      wyn_incidents: 0,
    } as const;

    expect(getEffectiveTrackingStatus({ ...base, wyn_group: "returned" }, [])).toBe(
      "not_delivered"
    );
    expect(
      getEffectiveTrackingStatus({ ...base, wyn_group: "incident", wyn_incidents: 1 }, [])
    ).toBe("incident");
  });

  it("nunca envia una guia MLCR al sincronizador masivo de Moovin", () => {
    const costaRica = FINANCE_STORES.find((store) => store.code === "mireva-cr");
    expect(costaRica).toBeDefined();

    const row = {
      row_key: "shopify:wyn",
      source: "shopify",
      guide_number: "MLCR000051603SD",
      courier: "Moovin",
      order_name: "#MCRC14721",
      customer_name: "Elida",
      boxful_status: "",
      internal_status: "matched",
      match_status: "matched",
      cod_amount: 19_900,
      shopify_order_name: "#MCRC14721",
      shopify_order_number: 14721,
      shopify_financial_status: "pending",
      shopify_fulfillment_status: "fulfilled",
      shopify_cancelled_at: null,
      shopify_created_at: "2026-07-16T00:00:00Z",
      package_items: [],
    } as TrackableOrderRow;

    const result = buildEnRouteGuides([row], new Map(), costaRica!);
    expect(result.moovin).toEqual([]);
    expect(result.forza).toEqual([]);
  });
});
