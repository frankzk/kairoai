// Novedades de c807 Xpress (Honduras) en la misma bandeja que Forza y Cargo Expreso.
//
// HISTORIA: c807 Xpress llevo parte de los envios de Mireva Honduras y Kairo no
// lo seguia. De 44 guias de septiembre, 15 terminaron devueltas, 3 tenian un
// intento fallido sin gestionar y 3 nunca las recogio c807 (13/10/2026).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyDetection, c807Category, detectC807Incident } from "../lib/incidents-detect";
import { courierYaNoReintenta, diasSinEntregaDe, esDiaSinEntrega } from "../lib/incidents-reprog";
import { INCIDENT_SOURCES } from "../lib/incidents-types";
import type { ShipmentTrackingRow } from "../lib/finance-types";
import type { ShopifyOrderSummary } from "../lib/finance-orders";

const ROOT = path.resolve(__dirname, "..");
const NOW = "2026-10-13T18:00:00.000Z";
const DIA = 86_400_000;
const hace = (dias: number) => new Date(Date.parse(NOW) - dias * DIA).toISOString();

function c807(over: Partial<ShipmentTrackingRow> = {}): ShipmentTrackingRow {
  return {
    store_id: 2,
    guide_number: "6595-13968-20260928000001",
    tracking_number: "6595-13968-20260928000001",
    latest_status: "Ingresado a bodega (HUB Principal SPS)",
    latest_code: "19",
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

function shopify(over: Partial<ShopifyOrderSummary> = {}): ShopifyOrderSummary {
  return {
    id: "gid://shopify/Order/2",
    order_number: 1002,
    name: "#MHN1002",
    customer_name: "Cliente de Prueba",
    phone: "50400000000",
    products: "",
    total: "990 HNL",
    total_price: 990,
    currency: "HNL",
    financial_status: "pending",
    fulfillment_status: "fulfilled",
    cancelled_at: null,
    created_at: hace(3),
    line_items: [],
    ...over,
  };
}

describe("c807Category: la causa por el motivo y el detalle del repartidor", () => {
  it("no contesta, numero equivocado, cerrado o punto de encuentro: el cliente no responde", () => {
    expect(c807Category("Direccion incompleta/no contesta: No contesta llamadas ni mensajes")).toBe("cliente_no_responde");
    expect(c807Category("Punto de encuentro/No contesta")).toBe("cliente_no_responde");
    expect(c807Category("Numero equivocado")).toBe("cliente_no_responde");
    expect(c807Category("Cerrado casa/negocio: No se encuentra en el lugar de entrega")).toBe("cliente_no_responde");
    // "Devolución" en un intento: manda el detalle.
    expect(c807Category("Devolución: Cliente no contesta y no brinda la dirección de entrega")).toBe("cliente_no_responde");
  });
  it("rechazo del cliente", () => {
    expect(c807Category("Cliente rechaza envío: Lo rechazo porque no es lo que pidio")).toBe("cliente_rechaza");
  });
  it("lo que es del courier, o una reprogramacion pedida, es fallo de entrega", () => {
    expect(c807Category("Por tiempo: Se salió tarde de bodega")).toBe("fallo_entrega");
    expect(c807Category("Mal Tiempo (Lluvia)")).toBe("fallo_entrega");
    expect(c807Category("Por Cobertura")).toBe("fallo_entrega");
    expect(c807Category("Reprogramación: Cliente dijo que estaba fuera de casa (nueva fecha 2026-10-02)")).toBe("fallo_entrega");
  });
});

describe("detectC807Incident", () => {
  it("un intento fallido entra a la bandeja con origen c807 y los datos del pedido", () => {
    const motivo = "Cliente rechaza envío: Solo pidió 1 frasco";
    const c = detectC807Incident(
      c807({
        latest_group: "failed",
        latest_code: "16",
        latest_status: "Intento de entrega fallido: Cliente rechaza envío",
        latest_at: hace(2),
        has_incident: true,
        incident_reason: motivo,
        events: [{ code: "16", group: "failed", title: "Intento de entrega fallido: Cliente rechaza envío", description: motivo, date: hace(2), note: "" }],
      }),
      undefined,
      shopify(),
      NOW
    )!;
    expect(c).toMatchObject({
      source: "c807",
      courier: "c807 Xpress",
      order_name: "#MHN1002",
      category: "cliente_rechaza",
      detail: motivo,
      last_failure_at: hace(2),
    });
    expect(applyDetection(null, c, NOW).action).toBe("insert");
  });

  it("una guia que c807 nunca recogio entra como demora, y lo dice", () => {
    const c = detectC807Incident(
      c807({ latest_group: "pending", latest_code: "1", latest_status: "Guía creada, sin recoger", latest_at: hace(15) }),
      undefined,
      shopify({ created_at: hace(20) }),
      NOW
    )!;
    expect(c.category).toBe("demora_entrega");
    expect(c.detail).toBe("Sin entregar tras 20 dias desde el pedido (Guía creada, sin recoger)");
  });

  it("en camino dentro de los tiempos normales no es novedad", () => {
    expect(detectC807Incident(c807(), undefined, shopify(), NOW)).toBeNull();
  });

  it("la devolucion cierra la novedad abierta como perdida", () => {
    const c = detectC807Incident(c807({ latest_group: "returned", latest_status: "Devuelto" }), undefined, shopify(), NOW)!;
    const existente = { id: 1, store_id: 2, incident_key: c.incident_key, source: "c807", status: "pendiente", manual_override: false, last_tracking_group: "failed" };
    expect(applyDetection(existente as never, c, NOW).patch.status).toBe("perdida");
  });
});

describe("reprogramar y nuevo envio con c807", () => {
  it("no entrega los domingos", () => {
    expect(esDiaSinEntrega("2026-10-18", diasSinEntregaDe("c807", "forza"))).toBe(true);
  });

  it("reintenta solo: el nuevo envio se cobra cuando devuelve", () => {
    expect(courierYaNoReintenta("c807", 4, false)).toBe(false);
    expect(courierYaNoReintenta("c807", 0, true)).toBe(true);
  });
});

describe("c807 esta conectado de punta a punta", () => {
  it("'c807' es un origen valido y la base lo acepta", () => {
    expect(INCIDENT_SOURCES).toContain("c807");
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0045_incidents_source_c807.sql"), "utf8");
    expect(sql).toMatch(/incidents_source_check[\s\S]*'c807'/);
  });

  it("la corrida de deteccion recorre el rastreo de c807", () => {
    const src = readFileSync(path.join(ROOT, "lib/incidents-run.ts"), "utf8");
    expect(src).toContain('listShipmentTracking(store.id, "c807"');
    expect(src).toContain("detectC807Incident(");
    expect(src).toContain("`c807:${store.id}`");
  });

  it("el detalle de la novedad trae el historial de c807", () => {
    const src = readFileSync(path.join(ROOT, "app/api/incidents/route.ts"), "utf8");
    expect(src).toContain('incident.source === "c807"');
  });

  it("el cron esta programado", () => {
    const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    expect(vercel.crons.map((c: { path: string }) => c.path)).toContain("/api/cron/c807");
  });
});
