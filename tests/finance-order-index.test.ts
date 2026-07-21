import { describe, expect, it } from "vitest";

import { mergeDispatchIntoTracking } from "../lib/dispatch";
import { normalizeSearchText } from "../lib/order-matching";
import {
  getEffectiveTrackingStatus,
  getSettlementTracesForLogisticsRow,
  getTrackingFilterFromStatus,
  matchesOrderSearch,
  type SettlementTrace,
  type TrackableOrderRow,
} from "../lib/finance-orders";
import { buildOrderIndexRecord } from "../lib/finance-order-index";

function row(overrides: Partial<TrackableOrderRow>): TrackableOrderRow {
  return {
    row_key: "shopify-1",
    source: "shopify",
    guide_number: "",
    order_name: "#MCRC14065",
    customer_name: "Juan Perez",
    boxful_status: "",
    internal_status: "",
    match_status: "matched",
    cod_amount: 12500,
    shopify_order_name: "#MCRC14065",
    shopify_order_number: 14065,
    shopify_financial_status: "pending",
    shopify_fulfillment_status: "",
    shopify_cancelled_at: null,
    shopify_created_at: "2026-07-01T10:00:00.000Z",
    package_items: [],
    ...overrides,
  } as TrackableOrderRow;
}

// La derivación del índice DEBE coincidir con resolveRows del endpoint:
//   status = mergeDispatchIntoTracking(getEffectiveTrackingStatus(row, traces), dispatch, row)
//   filter = getTrackingFilterFromStatus(status, row)
function expectedFilter(r: TrackableOrderRow, traceMap: Map<string, SettlementTrace[]>): string {
  const traces = getSettlementTracesForLogisticsRow(r, traceMap);
  const status = mergeDispatchIntoTracking(getEffectiveTrackingStatus(r, traces), r.dispatch_view ?? null, r);
  return getTrackingFilterFromStatus(status, r);
}

describe("buildOrderIndexRecord", () => {
  const empty = new Map<string, SettlementTrace[]>();

  it("entregado por Moovin -> tracking_filter delivered, is_delivered", () => {
    const r = row({ guide_number: "G-1", courier: "Moovin", moovin_group: "delivered" });
    const rec = buildOrderIndexRecord(r, empty);
    expect(rec.tracking_filter).toBe("delivered");
    expect(rec.tracking_filter).toBe(expectedFilter(r, empty));
    expect(rec.is_delivered).toBe(true);
    expect(rec.effective_status).toBe("delivered");
  });

  it("con guía sin estado final -> en_route", () => {
    const r = row({ guide_number: "G-2", courier: "Moovin" });
    const rec = buildOrderIndexRecord(r, empty);
    expect(rec.tracking_filter).toBe("en_route");
    expect(rec.tracking_filter).toBe(expectedFilter(r, empty));
  });

  it("shopify cancelado sin movimiento -> annulled", () => {
    const r = row({ shopify_cancelled_at: "2026-07-02T00:00:00Z" });
    const rec = buildOrderIndexRecord(r, empty);
    expect(rec.tracking_filter).toBe("annulled");
    expect(rec.tracking_filter).toBe(expectedFilter(r, empty));
  });

  it("sin guía ni movimiento -> pending", () => {
    const r = row({});
    const rec = buildOrderIndexRecord(r, empty);
    expect(rec.tracking_filter).toBe("pending");
    expect(rec.tracking_filter).toBe(expectedFilter(r, empty));
  });

  it("despacho solicitado (iComfly) fusiona sobre pending", () => {
    const r = row({ dispatch_view: "despacho_solicitado" });
    const rec = buildOrderIndexRecord(r, empty);
    expect(rec.tracking_filter).toBe("despacho_solicitado");
    expect(rec.tracking_filter).toBe(expectedFilter(r, empty));
  });

  it("settlement_count refleja las trazas de liquidación", () => {
    const traces = new Map<string, SettlementTrace[]>([
      [
        "mcrc14065",
        [
          { file_name: "a.xlsx", amount_to_liquidate: 100, settlement_status: "settled", internal_status: "ok" } as SettlementTrace,
          { file_name: "b.xlsx", amount_to_liquidate: 100, settlement_status: "settled", internal_status: "ok" } as SettlementTrace,
        ],
      ],
    ]);
    const r = row({ shopify_order_number: 14065, order_name: "#MCRC14065" });
    const rec = buildOrderIndexRecord(r, traces);
    expect(rec.settlement_count).toBe(getSettlementTracesForLogisticsRow(r, traces).length);
    expect(rec.settlement_count).toBeGreaterThanOrEqual(1);
  });

  it("order_date es el YYYY-MM-DD de shopify_created_at", () => {
    expect(buildOrderIndexRecord(row({}), empty).order_date).toBe("2026-07-01");
    expect(buildOrderIndexRecord(row({ shopify_created_at: null }), empty).order_date).toBeNull();
  });

  it("search_lower / search_compact reproducen matchesOrderSearch por campo", () => {
    const r = row({ guide_number: "MLCR000999", customer_name: "María Ñoño", package_items: [{ sku: "SKU-1", title: "Colágeno" } as TrackableOrderRow["package_items"][number]] });
    const rec = buildOrderIndexRecord(r, empty);
    // Cada consulta que matchea por campo debe estar contenida en el texto plano,
    // y el LIKE no cruza el separador '\n' (los queries no lo contienen).
    for (const q of ["14065", "mlcr000999", "colageno", "maria", "SKU-1"]) {
      const raw = q.trim().toLowerCase();
      const compact = normalizeSearchText(q);
      const hitLower = rec.search_lower.includes(raw);
      const hitCompact = rec.search_compact.includes(compact);
      expect(hitLower || hitCompact).toBe(matchesOrderSearch(r, q));
    }
  });
});
