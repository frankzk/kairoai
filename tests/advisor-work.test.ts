import { describe, expect, it } from "vitest";
import {
  advisorWorkActors,
  buildAdvisorWorkIndex,
  matchesAdvisorActivity,
  type AdvisorIcomflyRow,
} from "../lib/advisor-work";
import type { ConfirmationEventRow } from "../lib/order-confirmations";
const event = (
  over: Partial<ConfirmationEventRow> = {},
): ConfirmationEventRow => ({
  order_name: "#MCRC100",
  kind: "contacto",
  outcome: "confirmado",
  staff_id: 23,
  staff_name: "Rosa Tipiani",
  created_at: "2026-11-01T12:00:00Z",
  ...over,
});
const native = (over: Partial<AdvisorIcomflyRow> = {}): AdvisorIcomflyRow => ({
  icomfly_order_id: "2",
  order_number: "100",
  shopify_display_number: "#MCRC100",
  tracking_number: "",
  confirmed_by_staff_id: 23,
  confirmed_by_name: "Rosa Tipiani",
  confirmed_at: "2026-11-02T12:00:00Z",
  requested_by_staff_id: 23,
  requested_by_name: "Rosa Tipiani",
  requested_at: null,
  ...over,
});
describe("trabajo verificado de asesora, Kairo + iComfly", () => {
  it("une fuentes y gestiones sin duplicar el pedido ni inventar fechas ausentes", () => {
    const rows = [{ row_key: "boxful-1", order_name: "MCRC100" }];
    const index = buildAdvisorWorkIndex(
      23,
      rows,
      [
        event(),
        event(),
        event({ kind: "decision", outcome: "autorizar_despacho" }),
      ],
      [native()],
    );
    expect(index.byRow.size).toBe(1);
    expect(index.unmatchedNative).toBe(0);
    const work = index.byRow.get("boxful-1")!;
    expect(work.evidence).toHaveLength(4);
    expect(work.evidence.find((e) => e.kind === "dispatch_request")).toEqual({
      source: "icomfly",
      kind: "dispatch_request",
      at: null,
    });
    expect(matchesAdvisorActivity(work, "confirmation")).toBe(true);
    expect(matchesAdvisorActivity(work, "dispatch")).toBe(true);
  });
  it("usa ID externo, correlativo web y alias Shopify; la guia solo si es unica", () => {
    const rows = [
      { row_key: "shopify-icomfly-1", order_name: "IC-W7" },
      { row_key: "boxful-2", order_name: "IC-W8" },
      { row_key: "boxful-3", order_name: "OTRO", guide_number: "G1" },
      { row_key: "boxful-4", order_name: "OTRO2", guide_number: "DUP" },
      { row_key: "boxful-5", order_name: "OTRO3", guide_number: "DUP" },
    ];
    const index = buildAdvisorWorkIndex(
      23,
      rows,
      [],
      [
        native({
          icomfly_order_id: "1",
          shopify_display_number: "",
          order_number: "MANUAL-abc",
        }),
        native({
          icomfly_order_id: "9",
          shopify_display_number: "",
          web_seq: "8",
        }),
        native({
          icomfly_order_id: "10",
          shopify_display_number: "",
          tracking_number: "G1",
        }),
        native({
          icomfly_order_id: "11",
          shopify_display_number: "",
          tracking_number: "DUP",
        }),
      ],
    );
    expect(Array.from(index.byRow.keys())).toEqual([
      "shopify-icomfly-1",
      "boxful-2",
      "boxful-3",
    ]);
    expect(index.unmatchedNative).toBe(1);
  });
  it("no atribuye creadora, notas, llamadas, ni el trabajo de otra asesora", () => {
    const rows = [{ row_key: "x", order_name: "MCRC100" }];
    const index = buildAdvisorWorkIndex(
      23,
      rows,
      [
        event({ kind: "nota" }),
        event({ outcome: "contesto" }),
        event({ staff_id: 5 }),
      ],
      [native({ confirmed_by_staff_id: 5, requested_by_staff_id: 5 })],
    );
    expect(index.byRow.size).toBe(0);
    expect(matchesAdvisorActivity(undefined, "both")).toBe(false);
  });
  it("permite solo despacho y conserva el respaldo local cuando iComfly no lo atribuye", () => {
    const index = buildAdvisorWorkIndex(
      23,
      [{ row_key: "x", order_name: "MCRC100" }],
      [],
      [native({ confirmed_by_staff_id: null })],
    );
    expect(matchesAdvisorActivity(index.byRow.get("x"), "confirmation")).toBe(
      false,
    );
    expect(matchesAdvisorActivity(index.byRow.get("x"), "dispatch")).toBe(true);
    const local = buildAdvisorWorkIndex(
      23,
      [{ row_key: "y", shopify_order_name: "MCRC100" }],
      [event()],
      [],
    );
    expect(local.byRow.get("y")?.evidence).toHaveLength(1);
  });
  it("el catalogo une asesoras de ambas fuentes por ID", () => {
    expect(
      advisorWorkActors(
        [event()],
        [
          { staff_id: 23, name: "Rosa Tipiani" },
          { staff_id: 5, name: "Ana" },
          { staff_id: null, name: "Sin vincular" },
        ],
      ),
    ).toEqual([
      { id: 5, name: "Ana" },
      { id: 23, name: "Rosa Tipiani" },
    ]);
  });
});
