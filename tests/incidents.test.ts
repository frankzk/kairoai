import { describe, expect, it } from "vitest";
import {
  buildIncidentKey,
  mapMoovinCategory,
  mapBoxfulCategory,
  detectMoovinIncident,
  detectForzaIncident,
  detectBoxfulIncident,
  applyDetection,
} from "../lib/incidents-detect";
import type { MoovinTrackingRow, ForzaTrackingRow, LogisticsRow } from "../lib/finance-types";
import type { Incident } from "../lib/incidents-types";

function moovin(over: Partial<MoovinTrackingRow> = {}): MoovinTrackingRow {
  return {
    id_package: "",
    last_name: "",
    tracking_number: "",
    latest_status: "",
    latest_code: "",
    latest_group: "",
    latest_at: null,
    has_incident: false,
    incident_reason: "",
    delivery_address: "",
    events: [],
    checked_at: "",
    ...over,
  };
}

function forza(over: Partial<ForzaTrackingRow> = {}): ForzaTrackingRow {
  return {
    store_id: 2,
    guide_number: "",
    tracking_number: "",
    latest_status: "",
    latest_code: "",
    latest_group: "",
    latest_at: null,
    has_incident: false,
    incident_reason: "",
    delivery_address: "",
    receiver_name: "",
    events: [],
    checked_at: "",
    ...over,
  };
}

function logistics(over: Partial<LogisticsRow> = {}): LogisticsRow {
  return {
    id: 0,
    store_id: 1,
    import_id: 0,
    guide_number: "",
    order_name: "",
    store_order_number: "",
    customer_name: "",
    customer_phone: "",
    created_on: null,
    courier: "",
    boxful_status: "",
    internal_status: "pending",
    match_status: "unmatched",
    service_type: "",
    cod_amount: 0,
    cod_commission: 0,
    delivery_cost: 0,
    total_cost: 0,
    liquidated_on: null,
    finalized_on: null,
    label_url: "",
    package_items: [],
    shopify_order_id: "",
    shopify_order_name: "",
    shopify_order_number: null,
    shopify_financial_status: "",
    shopify_fulfillment_status: "",
    shopify_cancelled_at: null,
    shopify_total: 0,
    shopify_created_at: null,
    created_at: "",
    ...over,
  };
}

function incident(over: Partial<Incident> = {}): Incident {
  return {
    id: 1,
    store_id: 1,
    incident_key: "mcrc11518",
    source: "moovin",
    order_name: "",
    guide_number: "",
    shopify_order_id: "",
    customer_name: "",
    customer_phone: "",
    courier: "",
    cod_amount: 0,
    category: "fallo_entrega",
    status: "pendiente",
    detail: "",
    notes: "",
    reprogramada_para: null,
    intentos_llamada: 0,
    ultimo_intento_at: null,
    last_tracking_status: "",
    last_tracking_group: "",
    manual_override: false,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("buildIncidentKey", () => {
  it("unifica la misma guia con o sin # y espacios", () => {
    expect(buildIncidentKey(" #GUIA 123 ", "")).toBe("guia123");
    expect(buildIncidentKey("GUIA123", "")).toBe("guia123");
  });

  it("usa el nombre del pedido cuando no hay guia", () => {
    expect(buildIncidentKey("", "#MCRC11518")).toBe("mcrc11518");
  });

  it("prioriza la guia sobre el pedido", () => {
    expect(buildIncidentKey("GUIA9", "#MCRC11518")).toBe("guia9");
  });

  it("devuelve cadena vacia cuando no hay guia ni pedido", () => {
    expect(buildIncidentKey("", "")).toBe("");
  });
});

describe("mapMoovinCategory", () => {
  it("clasifica por palabra clave", () => {
    expect(mapMoovinCategory("Direccion incorrecta", "failed")).toBe("direccion_incorrecta");
    expect(mapMoovinCategory("El cliente no responde", "failed")).toBe("cliente_no_responde");
    expect(mapMoovinCategory("Cliente rechazo el paquete", "failed")).toBe("cliente_rechaza");
    expect(mapMoovinCategory("Paquete averiado", "failed")).toBe("dano_paquete");
  });

  it("devuelto cuando el grupo es returned, sin importar la razon", () => {
    expect(mapMoovinCategory("", "returned")).toBe("devuelto_origen");
  });

  it("cae a fallo_entrega por defecto", () => {
    expect(mapMoovinCategory("motivo desconocido", "failed")).toBe("fallo_entrega");
  });
});

describe("mapBoxfulCategory", () => {
  it("mapea estados de no entrega", () => {
    expect(mapBoxfulCategory("No entregado")).toBe("fallo_entrega");
    expect(mapBoxfulCategory("Devuelto")).toBe("devuelto_origen");
    expect(mapBoxfulCategory("Problemas en gestion")).toBe("fallo_entrega");
  });

  it("no genera novedad para estados normales", () => {
    expect(mapBoxfulCategory("Entregado")).toBeNull();
    expect(mapBoxfulCategory("En ruta a destino")).toBeNull();
    expect(mapBoxfulCategory("")).toBeNull();
  });
});

describe("detectMoovinIncident", () => {
  it("genera candidata cuando hay incidencia (failed)", () => {
    const c = detectMoovinIncident(
      moovin({ id_package: "GUIA1", has_incident: true, latest_group: "failed", incident_reason: "Direccion incorrecta", latest_status: "Fallo" }),
      logistics({ guide_number: "GUIA1", order_name: "#MCRC100", customer_phone: "88887777", shopify_order_id: "555" })
    );
    expect(c).not.toBeNull();
    expect(c!.incident_key).toBe("guia1");
    expect(c!.category).toBe("direccion_incorrecta");
    expect(c!.customer_phone).toBe("88887777");
    expect(c!.shopify_order_id).toBe("555");
    expect(c!.last_tracking_group).toBe("failed");
  });

  it("genera candidata de entrega (delivered) para permitir auto-resolucion", () => {
    const c = detectMoovinIncident(moovin({ id_package: "GUIA1", latest_group: "delivered" }));
    expect(c).not.toBeNull();
    expect(c!.last_tracking_group).toBe("delivered");
  });

  it("devuelve null cuando sigue en progreso", () => {
    expect(detectMoovinIncident(moovin({ id_package: "GUIA1", latest_group: "in_progress" }))).toBeNull();
  });

  it("funciona sin fila de logistica (usa datos del tracking)", () => {
    const c = detectMoovinIncident(moovin({ id_package: "GUIA9", has_incident: true, latest_group: "failed", incident_reason: "Cliente rechazo el paquete" }));
    expect(c!.incident_key).toBe("guia9");
    expect(c!.category).toBe("cliente_rechaza");
    expect(c!.courier).toBe("Moovin");
  });

  it("no genera incidencia activa para devuelto (terminal)", () => {
    expect(detectMoovinIncident(moovin({ id_package: "G", latest_group: "returned" }))).toBeNull();
  });

  it("asigna store_id desde la fila de logistica o el parametro", () => {
    const fromRow = detectMoovinIncident(
      moovin({ id_package: "G", has_incident: true, latest_group: "failed" }),
      logistics({ guide_number: "G", store_id: 2 })
    );
    expect(fromRow!.store_id).toBe(2);

    const fromParam = detectMoovinIncident(
      moovin({ id_package: "G2", has_incident: true, latest_group: "failed" }),
      undefined,
      2
    );
    expect(fromParam!.store_id).toBe(2);
  });
});

describe("detectForzaIncident", () => {
  it("genera candidata forza con store_id de Honduras", () => {
    const c = detectForzaIncident(
      forza({ guide_number: "FZ1", store_id: 2, has_incident: true, latest_group: "failed", incident_reason: "El cliente no responde" }),
      logistics({ guide_number: "FZ1", store_id: 2, order_name: "#MIRH900", customer_phone: "99990000" })
    );
    expect(c).not.toBeNull();
    expect(c!.source).toBe("forza");
    expect(c!.store_id).toBe(2);
    expect(c!.category).toBe("cliente_no_responde");
    expect(c!.customer_phone).toBe("99990000");
  });

  it("usa receiver_name y courier Forza sin fila de logistica", () => {
    const c = detectForzaIncident(
      forza({ guide_number: "FZ2", has_incident: true, latest_group: "failed", receiver_name: "Maria" })
    );
    expect(c!.customer_name).toBe("Maria");
    expect(c!.courier).toBe("Forza");
    expect(c!.store_id).toBe(2);
  });

  it("devuelve null cuando sigue en progreso", () => {
    expect(detectForzaIncident(forza({ guide_number: "FZ3", latest_group: "in_progress" }))).toBeNull();
  });
});

describe("detectBoxfulIncident", () => {
  it("genera candidata para no entregado", () => {
    const c = detectBoxfulIncident(logistics({ guide_number: "G2", order_name: "#MCRC200", boxful_status: "No entregado" }));
    expect(c).not.toBeNull();
    expect(c!.incident_key).toBe("g2");
    expect(c!.category).toBe("fallo_entrega");
    expect(c!.source).toBe("boxful");
  });

  it("devuelve null para entregado", () => {
    expect(detectBoxfulIncident(logistics({ boxful_status: "Entregado" }))).toBeNull();
  });
});

describe("applyDetection", () => {
  const cand = detectMoovinIncident(
    moovin({ id_package: "G1", has_incident: true, latest_group: "failed", incident_reason: "No responde" })
  )!;

  it("inserta una novedad nueva en estado pendiente", () => {
    const r = applyDetection(null, cand);
    expect(r.action).toBe("insert");
    expect(r.patch.status).toBe("pendiente");
    expect(r.patch.category).toBe("cliente_no_responde");
    expect(r.event?.kind).toBe("detectada");
  });

  it("no crea novedad para una entrega ya confirmada", () => {
    const delivered = detectMoovinIncident(moovin({ id_package: "G1", latest_group: "delivered" }))!;
    expect(applyDetection(null, delivered).action).toBe("skip");
  });

  it("no pisa el estado cuando hay gestion manual", () => {
    const r = applyDetection(incident({ status: "reprogramada", manual_override: true }), cand);
    expect(r.action).toBe("update");
    expect(r.patch.status).toBeUndefined();
  });

  it("no reabre una novedad en estado terminal", () => {
    const r = applyDetection(incident({ status: "perdida", manual_override: false }), cand);
    expect(r.patch.status).toBeUndefined();
  });

  it("auto-resuelve cuando el courier confirma la entrega", () => {
    const delivered = detectMoovinIncident(moovin({ id_package: "G1", latest_group: "delivered" }))!;
    const r = applyDetection(incident({ status: "sin_contestar", manual_override: false }), delivered);
    expect(r.patch.status).toBe("resuelta");
    expect(r.event?.to_status).toBe("resuelta");
  });

  it("rellena datos vacios sin sobrescribir los del operador", () => {
    const r = applyDetection(
      incident({ customer_phone: "", shopify_order_id: "999" }),
      { ...cand, customer_phone: "70000000", shopify_order_id: "111" }
    );
    expect(r.patch.customer_phone).toBe("70000000"); // estaba vacio: se rellena
    expect(r.patch.shopify_order_id).toBeUndefined(); // ya tenia valor: no se pisa
  });
});
