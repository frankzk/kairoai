import { describe, expect, it } from "vitest";
import {
  buildCustomerBehaviorIndex,
  classifyCustomerLevel,
  customerEmailKey,
  customerPhoneKey,
  type SettlementTrace,
  type TrackableOrderRow,
} from "../lib/finance-orders";

// Filas mínimas: el estado del semáforo se deriva de getEffectiveTrackingStatus,
// que con moovin/forza vacíos y sin trazas se resuelve por internal_status
// (delivered/not_delivered finales) o por la lógica de anulado/pendiente.
function makeRow(partial: Partial<TrackableOrderRow> & { row_key: string }): TrackableOrderRow {
  return {
    source: "shopify",
    guide_number: "",
    order_name: "#X",
    customer_name: "Cliente",
    boxful_status: "",
    internal_status: "pending",
    match_status: "matched",
    cod_amount: 0,
    shopify_order_name: "",
    shopify_order_number: null,
    shopify_financial_status: "",
    shopify_fulfillment_status: "",
    shopify_cancelled_at: null,
    shopify_created_at: null,
    package_items: [],
    ...partial,
  };
}

const delivered = (extra: Partial<TrackableOrderRow> & { row_key: string }) =>
  makeRow({ internal_status: "delivered", ...extra });
const notDelivered = (extra: Partial<TrackableOrderRow> & { row_key: string }) =>
  makeRow({ internal_status: "not_delivered", ...extra });
const annulled = (extra: Partial<TrackableOrderRow> & { row_key: string }) =>
  makeRow({ source: "shopify", internal_status: "annulled", shopify_cancelled_at: "2024-01-01T00:00:00Z", ...extra });
const enCurso = (extra: Partial<TrackableOrderRow> & { row_key: string }) =>
  makeRow({ internal_status: "pending", ...extra });

const noTraces = new Map<string, SettlementTrace[]>();

describe("customerPhoneKey", () => {
  it("usa los ultimos 8 digitos, ignorando codigo de pais, espacios y guiones", () => {
    expect(customerPhoneKey("+504 9999-9999")).toBe("99999999");
    expect(customerPhoneKey("50499999999")).toBe("99999999");
    expect(customerPhoneKey("9999 9999")).toBe("99999999");
    expect(customerPhoneKey("+506 8888 8888")).toBe("88888888");
  });

  it("agrupa el mismo numero con y sin codigo de pais", () => {
    expect(customerPhoneKey("+504 1111-1111")).toBe(customerPhoneKey("1111-1111"));
  });

  it("vacio si no hay suficientes digitos o no hay telefono", () => {
    expect(customerPhoneKey("123")).toBe("");
    expect(customerPhoneKey("")).toBe("");
    expect(customerPhoneKey(null)).toBe("");
    expect(customerPhoneKey(undefined)).toBe("");
  });
});

describe("customerEmailKey", () => {
  it("normaliza a minusculas sin espacios", () => {
    expect(customerEmailKey("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("vacio si no hay email", () => {
    expect(customerEmailKey(null)).toBe("");
    expect(customerEmailKey("")).toBe("");
  });
});

describe("classifyCustomerLevel (por tasa de fallas sobre resueltos)", () => {
  it("rojo cuando la tasa de fallas es alta (1 devolucion de 2 resueltos = 50%)", () => {
    expect(classifyCustomerLevel({ delivered: 1, not_delivered: 1, annulled: 0 })).toBe("problem");
  });
  it("verde cuando casi todo se entrega (1 de 11 = ~9%)", () => {
    expect(classifyCustomerLevel({ delivered: 10, not_delivered: 1, annulled: 0 })).toBe("good");
  });
  it("verde sin fallas (>=2 resueltos)", () => {
    expect(classifyCustomerLevel({ delivered: 2, not_delivered: 0, annulled: 0 })).toBe("good");
  });
  it("ambar en tasa intermedia (1 de 4 = 25%)", () => {
    expect(classifyCustomerLevel({ delivered: 3, not_delivered: 1, annulled: 0 })).toBe("risk");
  });
  it("ambar cuando hay pocos resueltos (sin historial suficiente)", () => {
    expect(classifyCustomerLevel({ delivered: 1, not_delivered: 0, annulled: 0 })).toBe("risk");
  });
  it("los anulados cuentan como falla en la tasa", () => {
    expect(classifyCustomerLevel({ delivered: 0, not_delivered: 0, annulled: 2 })).toBe("problem");
  });
});

describe("buildCustomerBehaviorIndex", () => {
  it("agrupa por telefono y clasifica (3 pedidos, 1 devolucion = rojo)", () => {
    const rows = [
      delivered({ row_key: "a", customer_phone: "+504 1111-1111" }),
      notDelivered({ row_key: "b", customer_phone: "1111 1111" }),
      enCurso({ row_key: "c", customer_phone: "50411111111" }),
    ];
    const index = buildCustomerBehaviorIndex(rows, noTraces);
    const a = index.get("a");
    expect(a).toBeDefined();
    expect(a).toEqual(index.get("b"));
    expect(a).toEqual(index.get("c"));
    expect(a?.total).toBe(3);
    expect(a?.delivered).toBe(1);
    expect(a?.not_delivered).toBe(1);
    expect(a?.en_curso).toBe(1);
    expect(a?.level).toBe("problem");
  });

  it("no marca a clientes con un solo pedido", () => {
    const rows = [delivered({ row_key: "solo", customer_phone: "+504 2222-2222" })];
    const index = buildCustomerBehaviorIndex(rows, noTraces);
    expect(index.get("solo")).toBeUndefined();
    expect(index.size).toBe(0);
  });

  it("agrupa por email cuando el telefono no coincide", () => {
    const rows = [
      delivered({ row_key: "a", customer_phone: "", customer_email: "Cliente@Mail.com" }),
      delivered({ row_key: "b", customer_phone: "9999 0000", customer_email: "cliente@mail.com" }),
    ];
    const index = buildCustomerBehaviorIndex(rows, noTraces);
    expect(index.get("a")).toEqual(index.get("b"));
    expect(index.get("a")?.total).toBe(2);
    expect(index.get("a")?.level).toBe("good");
  });

  it("une transitivamente: A~B por telefono y B~C por email son un cliente", () => {
    const rows = [
      delivered({ row_key: "a", customer_phone: "+504 3333-3333" }),
      delivered({ row_key: "b", customer_phone: "3333 3333", customer_email: "x@y.com" }),
      delivered({ row_key: "c", customer_email: "X@Y.com" }),
    ];
    const index = buildCustomerBehaviorIndex(rows, noTraces);
    expect(index.get("a")?.total).toBe(3);
    expect(index.get("a")).toEqual(index.get("c"));
    expect(index.get("a")?.level).toBe("good");
  });

  it("cuenta los anulados y mantiene clientes distintos separados", () => {
    const rows = [
      annulled({ row_key: "a1", customer_phone: "+504 4444-4444" }),
      annulled({ row_key: "a2", customer_phone: "4444 4444" }),
      delivered({ row_key: "b1", customer_phone: "+504 5555-5555" }),
      delivered({ row_key: "b2", customer_phone: "5555 5555" }),
    ];
    const index = buildCustomerBehaviorIndex(rows, noTraces);
    expect(index.get("a1")?.annulled).toBe(2);
    expect(index.get("a1")?.level).toBe("problem");
    expect(index.get("b1")?.level).toBe("good");
    // Clientes distintos: no comparten el resumen.
    expect(index.get("a1")).not.toEqual(index.get("b1"));
  });

  it("clientes sin telefono ni email no se agrupan entre si", () => {
    const rows = [
      delivered({ row_key: "x", customer_phone: "", customer_email: "" }),
      delivered({ row_key: "y", customer_phone: "", customer_email: "" }),
    ];
    const index = buildCustomerBehaviorIndex(rows, noTraces);
    expect(index.size).toBe(0);
  });
});
