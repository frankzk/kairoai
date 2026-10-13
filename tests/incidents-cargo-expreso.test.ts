// Novedades de Cargo Expreso (Honduras) en la misma bandeja que Forza.
//
// HISTORIA: Cargo Expreso lleva parte de los envios de Mireva Honduras (guias
// BH...-1) y Kairo no lo seguia. De 60 guias de septiembre y octubre, 22 se
// devolvieron y 6 tenian un intento fallido sin gestionar (13/10/2026): nada de
// eso llegaba a Novedades. A diferencia de Forza, Cargo Expreso si informa cada
// intento con su motivo, asi que no hay que deducirlo.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyDetection, cargoExpresoCategory, detectCargoExpresoIncident } from "../lib/incidents-detect";
import { courierYaNoReintenta, diasSinEntregaDe, esDiaSinEntrega } from "../lib/incidents-reprog";
import { INCIDENT_SOURCES, type Incident } from "../lib/incidents-types";
import type { CargoExpresoTrackingRow } from "../lib/finance-types";
import type { ShopifyOrderSummary } from "../lib/finance-orders";

const ROOT = path.resolve(__dirname, "..");
const NOW = "2026-10-13T18:00:00.000Z";
const DIA = 86_400_000;
const hace = (dias: number) => new Date(Date.parse(NOW) - dias * DIA).toISOString();

function caex(over: Partial<CargoExpresoTrackingRow> = {}): CargoExpresoTrackingRow {
  return {
    store_id: 2,
    guide_number: "BH000000001-1",
    tracking_number: "BH000000001-1",
    latest_status: "Salida de bodega (TGU)",
    latest_code: "E",
    latest_group: "in_progress",
    latest_at: hace(1),
    has_incident: false,
    incident_reason: "",
    delivery_address: "",
    receiver_name: "",
    events: [],
    checked_at: NOW,
    ...over,
  };
}

const fallo = (motivo: string, dias = 1) =>
  caex({
    latest_group: "failed",
    latest_code: "D",
    latest_status: `Intento de entrega fallido: ${motivo}`,
    latest_at: hace(dias),
    has_incident: true,
    incident_reason: motivo,
    events: [
      { code: "I", group: "in_progress", title: "Ingreso a bodega (TGU)", description: "", date: hace(dias - 0.01), note: "TGU" },
      { code: "D", group: "failed", title: `Intento de entrega fallido: ${motivo}`, description: motivo, date: hace(dias), note: "TGU" },
    ],
  });

function shopify(over: Partial<ShopifyOrderSummary> = {}): ShopifyOrderSummary {
  return {
    id: "gid://shopify/Order/1",
    order_number: 1001,
    name: "#MHN1001",
    customer_name: "Cliente de Prueba",
    phone: "50400000000",
    products: "",
    total: "1290 HNL",
    total_price: 1290,
    currency: "HNL",
    financial_status: "pending",
    fulfillment_status: "fulfilled",
    cancelled_at: null,
    created_at: hace(3),
    line_items: [],
    ...over,
  };
}

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: 1,
    store_id: 2,
    incident_key: "bh000000001-1",
    source: "cargoexpreso",
    order_name: "#MHN1001",
    guide_number: "BH000000001-1",
    shopify_order_id: "",
    customer_name: "",
    customer_phone: "",
    courier: "Cargo Expreso",
    cod_amount: 1290,
    category: "cliente_no_responde",
    status: "pendiente",
    detail: "",
    notes: "",
    reprogramada_para: null,
    reprogramada_at: null,
    intentos_llamada: 0,
    ultimo_intento_at: null,
    last_tracking_status: "",
    last_tracking_group: "failed",
    manual_override: false,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("cargoExpresoCategory: la causa por el motivo del intento", () => {
  it("nadie en casa o no llego al punto de encuentro: el cliente no responde", () => {
    expect(cargoExpresoCategory("005 Nadie en casa")).toBe("cliente_no_responde");
    expect(cargoExpresoCategory("Cliente no llegó a punto de encuentro.")).toBe("cliente_no_responde");
  });
  it("no quiso recibir o no tenia el dinero: rechazo", () => {
    expect(cargoExpresoCategory("002 Cliente no quizo recibir")).toBe("cliente_rechaza");
    expect(cargoExpresoCategory("003 Cliente no tiene dinero")).toBe("cliente_rechaza");
  });
  it("direccion que no corresponde", () => {
    expect(cargoExpresoCategory("004 Direccion  no corresponde")).toBe("direccion_incorrecta");
  });
  it("lo que es del courier es fallo de entrega", () => {
    expect(cargoExpresoCategory("No Dio Tiempo")).toBe("fallo_entrega");
    expect(cargoExpresoCategory("Falla mecánica")).toBe("fallo_entrega");
  });
});

describe("detectCargoExpresoIncident", () => {
  it("un intento fallido entra a la bandeja con origen cargoexpreso y los datos del pedido", () => {
    const c = detectCargoExpresoIncident(fallo("005 Nadie en casa"), undefined, shopify(), NOW)!;
    expect(c).toMatchObject({
      store_id: 2,
      source: "cargoexpreso",
      courier: "Cargo Expreso",
      order_name: "#MHN1001",
      customer_name: "Cliente de Prueba",
      customer_phone: "50400000000",
      cod_amount: 1290,
      category: "cliente_no_responde",
      detail: "005 Nadie en casa",
      last_tracking_group: "failed",
      last_failure_at: hace(1),
    });
    expect(applyDetection(null, c, NOW).action).toBe("insert");
  });

  it("un envio en camino dentro de los tiempos normales no es novedad", () => {
    expect(detectCargoExpresoIncident(caex(), undefined, shopify(), NOW)).toBeNull();
  });

  it("7 dias sin movimiento es demora (los que se quedaron asi terminaron devueltos)", () => {
    const c = detectCargoExpresoIncident(caex({ latest_at: hace(8) }), undefined, shopify({ created_at: hace(11) }), NOW)!;
    expect(c.category).toBe("demora_entrega");
    expect(c.detail).toContain("Sin movimiento del courier hace 8 dias");
  });

  it("un pedido cancelado no es demora", () => {
    expect(
      detectCargoExpresoIncident(caex({ latest_at: hace(8) }), undefined, shopify({ cancelled_at: hace(5) }), NOW)
    ).toBeNull();
  });

  it("la entrega cierra la novedad abierta", () => {
    const c = detectCargoExpresoIncident(caex({ latest_group: "delivered", latest_status: "Entregado" }), undefined, shopify(), NOW)!;
    expect(applyDetection(incident(), c, NOW).patch.status).toBe("resuelta");
  });

  it("la devolucion la pasa a perdida", () => {
    const c = detectCargoExpresoIncident(caex({ latest_group: "returned", latest_status: "Devuelto" }), undefined, shopify(), NOW)!;
    expect(c.category).toBe("devuelto_origen");
    expect(applyDetection(incident(), c, NOW).patch.status).toBe("perdida");
  });

  it("un intento nuevo despues de reprogramar es reprogramacion fallida", () => {
    const c = detectCargoExpresoIncident(fallo("005 Nadie en casa", 1), undefined, shopify(), NOW)!;
    const r = applyDetection(incident({ status: "reprogramada", reprogramada_at: hace(2), reprogramada_para: hace(1).slice(0, 10) }), c, NOW);
    expect(r.patch.status).toBe("reprog_fallida");
  });
});

describe("reprogramar y nuevo envio con Cargo Expreso", () => {
  it("no entrega los domingos (ningun intento en domingo en septiembre y octubre)", () => {
    expect(esDiaSinEntrega("2026-10-18", diasSinEntregaDe("cargoexpreso", "forza"))).toBe(true);
    expect(esDiaSinEntrega("2026-10-19", diasSinEntregaDe("cargoexpreso", "forza"))).toBe(false);
  });

  it("los dias son los del courier de la novedad, no los de la tienda", () => {
    expect(diasSinEntregaDe("wyn", "moovin")).toEqual([]);
    expect(diasSinEntregaDe("forza", "forza")).toEqual([0]);
    // Una novedad cargada a mano usa el courier principal de la tienda.
    expect(diasSinEntregaDe("manual", "forza")).toEqual([0]);
  });

  it("el nuevo envio se cobra cuando Cargo Expreso devuelve, no por el numero de intentos", () => {
    // Reintenta solo: hubo devoluciones despues de 0 y de 4 intentos.
    expect(courierYaNoReintenta("cargoexpreso", 3, false)).toBe(false);
    expect(courierYaNoReintenta("cargoexpreso", 0, true)).toBe(true);
    // Moovin y Forza: despues del segundo intento, como antes.
    expect(courierYaNoReintenta("moovin", 2, false)).toBe(true);
    expect(courierYaNoReintenta("forza", 1, false)).toBe(false);
  });
});

describe("Cargo Expreso esta conectado de punta a punta", () => {
  it("'cargoexpreso' es un origen valido y la base lo acepta", () => {
    expect(INCIDENT_SOURCES).toContain("cargoexpreso");
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0044_incidents_source_cargoexpreso.sql"), "utf8");
    expect(sql).toMatch(/incidents_source_check[\s\S]*'cargoexpreso'/);
  });

  it("la corrida de deteccion recorre el rastreo de Cargo Expreso", () => {
    const src = readFileSync(path.join(ROOT, "lib/incidents-run.ts"), "utf8");
    expect(src).toContain("listCargoExpresoTracking(");
    expect(src).toContain("detectCargoExpresoIncident(");
    expect(src).toContain("`cargoexpreso:${store.id}`");
  });

  it("el detalle de la novedad trae el historial de Cargo Expreso", () => {
    const src = readFileSync(path.join(ROOT, "app/api/incidents/route.ts"), "utf8");
    expect(src).toContain('incident.source === "cargoexpreso"');
  });

  it("el cron esta programado", () => {
    const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    expect(vercel.crons.map((c: { path: string }) => c.path)).toContain("/api/cron/cargo-expreso");
  });
});
