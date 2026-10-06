// Novedades de WYN en la misma bandeja que Moovin y Forza.
//
// HISTORIA: la deteccion solo recorria Moovin (CR) y Forza (HN). WYN, el
// segundo courier de Costa Rica, tenia su rastreo guardado en courier_shipments
// —4 guias en incidencia y 11 en camino hace mas de 14 dias, medido el
// 06/10/2026— y ninguna aparecia en Novedades: habia que ir a buscarlas a otra
// pantalla.
//
// WYN habla otro idioma de estados y eso es lo que estos tests fijan: su falla
// se llama "incident" (no "failed"), y marca has_incident tambien en las
// devueltas, asi que copiar la regla de Forza tal cual habria creado 205
// novedades de paquetes que volvieron hace meses.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applyDetection, detectWynIncident, wynGroupForIncidents } from "../lib/incidents-detect";
import { wynRunVerdict } from "../lib/wyn";
import { INCIDENT_SOURCES, type Incident } from "../lib/incidents-types";
import type { LogisticsRow, WynTrackingRow } from "../lib/finance-types";
import type { ShopifyOrderSummary } from "../lib/finance-orders";

const ROOT = path.resolve(__dirname, "..");
const NOW = "2026-10-06T15:00:00.000Z";

function wyn(over: Partial<WynTrackingRow> = {}): WynTrackingRow {
  return {
    store_id: 1,
    guide_number: "MLCR000327904SD",
    tracking_number: "MLCR000327904SD",
    latest_status: "",
    latest_code: "",
    latest_group: "en_route",
    latest_at: null,
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
    id: "gid://shopify/Order/18930146443580",
    order_number: 24631,
    name: "#MCRC24631",
    customer_name: "Lesbia Solano Diaz",
    phone: "50672890208",
    products: "",
    total: "19900 CRC",
    total_price: 19900,
    currency: "CRC",
    financial_status: "pending",
    fulfillment_status: "fulfilled",
    cancelled_at: null,
    created_at: "2026-10-03T23:08:34.000Z",
    line_items: [],
    ...over,
  };
}

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: 1,
    store_id: 1,
    incident_key: "mlcr000327904sd",
    source: "wyn",
    order_name: "#MCRC24631",
    guide_number: "MLCR000327904SD",
    shopify_order_id: "",
    customer_name: "",
    customer_phone: "",
    courier: "WYN",
    cod_amount: 19900,
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

describe("wynGroupForIncidents: el idioma de WYN al de la bandeja", () => {
  it("la falla de WYN es 'incident' y la bandeja la entiende como 'failed'", () => {
    expect(wynGroupForIncidents("incident")).toBe("failed");
  });
  it("devuelto, siniestrado/robado y cancelado cierran igual: como devolucion", () => {
    expect(wynGroupForIncidents("returned")).toBe("returned");
    expect(wynGroupForIncidents("not_delivered")).toBe("returned");
    expect(wynGroupForIncidents("cancelled")).toBe("returned");
  });
  it("entregado sigue siendo entregado y lo demas es envio en curso", () => {
    expect(wynGroupForIncidents("delivered")).toBe("delivered");
    expect(wynGroupForIncidents("en_route")).toBe("en_route");
    expect(wynGroupForIncidents("pending")).toBe("pending");
  });
});

describe("detectWynIncident", () => {
  it("una falla de WYN entra a la bandeja con origen wyn y los datos del pedido", () => {
    const c = detectWynIncident(
      wyn({ latest_group: "incident", latest_code: "LM-7", latest_status: "Destinatario ausente", has_incident: true }),
      undefined,
      shopify(),
      NOW
    );
    expect(c).not.toBeNull();
    expect(c!.source).toBe("wyn");
    expect(c!.courier).toBe("WYN");
    expect(c!.incident_key).toBe("mlcr000327904sd");
    expect(c!.order_name).toBe("#MCRC24631");
    expect(c!.customer_name).toBe("Lesbia Solano Diaz");
    expect(c!.customer_phone).toBe("50672890208");
    expect(c!.cod_amount).toBe(19900);
    expect(c!.category).toBe("cliente_no_responde");
    expect(c!.last_tracking_group).toBe("failed");
  });

  it("la causa sale del codigo, no del texto", () => {
    // "Domicilio de entrega incorrecto" no dice "direccion": por texto caeria
    // en fallo_entrega.
    const causa = (code: string, status: string) =>
      detectWynIncident(wyn({ latest_group: "incident", latest_code: code, latest_status: status }), undefined, shopify(), NOW)!
        .category;
    expect(causa("LM-9", "Domicilio de entrega incorrecto")).toBe("direccion_incorrecta");
    expect(causa("LM-8", "Llego a domicilio y se rechazo el paquete")).toBe("cliente_rechaza");
    expect(causa("LM-7", "Destinatario ausente")).toBe("cliente_no_responde");
    expect(causa("LM-6", "Zona de entrega intransitable")).toBe("fallo_entrega");
    // Codigo desconocido: cae al mapeo por texto que comparten los couriers.
    expect(causa("ZZ-1", "El cliente no contesta")).toBe("cliente_no_responde");
  });

  it("una devuelta NO crea novedad aunque WYN la marque has_incident", () => {
    // El caso que copiar la regla de Forza rompia: 205 guias devueltas, todas
    // con has_incident = true, se habrian convertido en novedades pendientes.
    const c = detectWynIncident(
      wyn({ latest_group: "returned", latest_code: "PF-2", has_incident: true }),
      undefined,
      shopify(),
      NOW
    );
    expect(c!.last_tracking_group).toBe("returned");
    expect(applyDetection(null, c!, NOW).action).toBe("skip");
  });

  it("siniestrado o robado tampoco crea: es un cierre, no algo que gestionar", () => {
    const c = detectWynIncident(wyn({ latest_group: "not_delivered", has_incident: true }), undefined, shopify(), NOW);
    expect(applyDetection(null, c!, NOW).action).toBe("skip");
  });

  it("en camino y en plazo: nada que hacer todavia", () => {
    expect(
      detectWynIncident(wyn({ latest_group: "en_route", latest_at: "2026-10-05T10:00:00Z" }), undefined, shopify(), NOW)
    ).toBeNull();
  });

  it("en camino hace mas de 14 dias desde el pedido: demora", () => {
    const c = detectWynIncident(
      wyn({ latest_group: "en_route", latest_at: "2026-10-05T10:00:00Z" }),
      undefined,
      shopify({ created_at: "2026-09-10T10:00:00Z" }),
      NOW
    );
    expect(c!.category).toBe("demora_entrega");
    expect(c!.detail).toMatch(/dias desde el pedido/);
    expect(applyDetection(null, c!, NOW).action).toBe("insert");
  });

  it("la logistica importada manda sobre Shopify para los datos del cliente", () => {
    const row = { guide_number: "MLCR000327904SD", order_name: "#MCRC24631", customer_phone: "50611112222", courier: "WYN", cod_amount: 18000 } as LogisticsRow;
    const c = detectWynIncident(wyn({ latest_group: "incident", latest_code: "LM-7" }), row, shopify(), NOW);
    expect(c!.customer_phone).toBe("50611112222");
    expect(c!.cod_amount).toBe(18000);
  });

  it("la fecha de la ultima falla sale de los eventos 'incident' de WYN", () => {
    const c = detectWynIncident(
      wyn({
        latest_group: "incident",
        latest_code: "LM-7",
        events: [
          { code: "LM-7", group: "incident", title: "Destinatario ausente", description: "", date: "2026-10-05T18:00:00Z", note: "" },
          { code: "LM-2", group: "en_route", title: "En manos del cartero", description: "", date: "2026-10-05T08:00:00Z", note: "" },
          { code: "LM-7", group: "incident", title: "Destinatario ausente", description: "", date: "2026-10-04T18:00:00Z", note: "" },
        ],
      }),
      undefined,
      shopify(),
      NOW
    );
    expect(c!.last_failure_at).toBe("2026-10-05T18:00:00Z");
  });
});

describe("una novedad de WYN abierta se cierra sola, igual que las de Moovin", () => {
  it("entregada -> Resuelta", () => {
    const c = detectWynIncident(wyn({ latest_group: "delivered" }), undefined, shopify(), NOW)!;
    const r = applyDetection(incident(), c, NOW);
    expect(r.patch.status).toBe("resuelta");
  });
  it("devuelta -> Perdida", () => {
    const c = detectWynIncident(wyn({ latest_group: "returned", has_incident: true }), undefined, shopify(), NOW)!;
    expect(applyDetection(incident(), c, NOW).patch.status).toBe("perdida");
  });
  it("siniestrada/robada -> Perdida", () => {
    const c = detectWynIncident(wyn({ latest_group: "not_delivered", has_incident: true }), undefined, shopify(), NOW)!;
    expect(applyDetection(incident(), c, NOW).patch.status).toBe("perdida");
  });
  it("reprogramada que vuelve a fallar en WYN -> Reprogramacion fallida", () => {
    const c = detectWynIncident(
      wyn({
        latest_group: "incident",
        latest_code: "LM-7",
        events: [{ code: "LM-7", group: "incident", title: "", description: "", date: "2026-10-06T12:00:00Z", note: "" }],
      }),
      undefined,
      shopify(),
      NOW
    )!;
    const r = applyDetection(
      incident({ status: "reprogramada", reprogramada_at: "2026-10-05T12:00:00Z", reprogramada_para: "2026-10-08" }),
      c,
      NOW
    );
    expect(r.patch.status).toBe("reprog_fallida");
  });
});

describe("WYN esta conectado de punta a punta", () => {
  it("'wyn' es un origen valido para la API de novedades", () => {
    expect(INCIDENT_SOURCES).toContain("wyn");
  });

  it("la corrida de deteccion recorre el rastreo de WYN", () => {
    const src = readFileSync(path.join(ROOT, "lib/incidents-run.ts"), "utf8");
    expect(src).toContain("listWynTracking(");
    expect(src).toContain("detectWynIncident(");
    expect(src).toContain("`wyn:${store.id}`");
  });

  it("la base acepta source = 'wyn' (sin la migracion, el primer insert rompe todo el cron)", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0039_incidents_source_wyn.sql"), "utf8");
    expect(sql).toMatch(/incidents_source_check[\s\S]*'wyn'/);
    for (const source of INCIDENT_SOURCES) expect(sql).toContain(`'${source}'`);
  });

  it("el detalle de la novedad trae el historial de WYN", () => {
    const src = readFileSync(path.join(ROOT, "app/api/incidents/route.ts"), "utf8");
    expect(src).toContain('incident.source === "wyn"');
  });
});

describe("wynRunVerdict: una corrida que no leyo ninguna guia es mala", () => {
  const timeout = { error: "WYN no respondio dentro de 10 segundos." };

  it("el caso real del 06/10: 12 candidatas, 0 leidas -> no ok, con el motivo", () => {
    const v = wynRunVerdict({ candidates: 12, checked: 0, blocked: false, errors: [timeout] });
    expect(v.ok).toBe(false);
    expect(v.error).toContain("ninguna de las 12");
    expect(v.error).toContain("10 segundos");
  });
  it("si lee al menos una, la corrida es buena aunque otras fallen", () => {
    expect(wynRunVerdict({ candidates: 12, checked: 1, blocked: false, errors: [timeout] }).ok).toBe(true);
  });
  it("sin candidatas no hay nada que leer: ok", () => {
    expect(wynRunVerdict({ candidates: 0, checked: 0, blocked: false, errors: [] }).ok).toBe(true);
  });
  it("bloqueo sigue siendo no ok, como antes", () => {
    expect(wynRunVerdict({ candidates: 5, checked: 2, blocked: true, errors: [{ error: "WYN respondio HTTP 429." }] }).ok).toBe(false);
  });
});
