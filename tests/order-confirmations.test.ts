import { describe, expect, it } from "vitest";
import {
  buildKairoConfirmationIndex,
  findKairoConfirmation,
  type ConfirmationEventRow,
} from "../lib/order-confirmations";
const e = (
  overrides: Partial<ConfirmationEventRow> = {},
): ConfirmationEventRow => ({
  order_name: "#MCRC100",
  kind: "contacto",
  outcome: "confirmado",
  staff_id: 23,
  staff_name: "Rosa Tipiani",
  created_at: "2026-11-04T12:00:00Z",
  ...overrides,
});
describe("evidencia de confirmación local por asesora", () => {
  it("deduplica confirmaciones repetidas por pedido y retiene la fecha más reciente", () => {
    const x = buildKairoConfirmationIndex([
      e(),
      e({ order_name: "mcrc100", created_at: "2026-11-05T12:00:00Z" }),
      e({ created_at: "2026-11-03T12:00:00Z" }),
    ]);
    expect(x.actors).toEqual([{ id: 23, name: "Rosa Tipiani" }]);
    expect(x.byActorAndOrder.size).toBe(1);
    expect(findKairoConfirmation(x, 23, { order_name: "MCRC100" })?.at).toBe(
      "2026-11-05T12:00:00Z",
    );
  });
  it("no confunde creadora, nota, autorización de despacho o contacto con confirmar", () => {
    const x = buildKairoConfirmationIndex([
      e({ kind: "nota" }),
      e({ outcome: "contesto" }),
      e({ kind: "decision", outcome: "autorizar_despacho" }),
      e({ staff_id: null }),
      e({ created_at: "invalid" }),
    ]);
    expect(x.actors).toEqual([]);
    expect(findKairoConfirmation(x, 23, { order_name: "#MCRC100" })).toBeNull();
  });
  it("usa ID de asesora y referencia exacta, incluyendo el alias Shopify", () => {
    const x = buildKairoConfirmationIndex([
      e(),
      e({ staff_id: 1, staff_name: "Otra" }),
    ]);
    expect(
      findKairoConfirmation(x, 23, {
        order_name: "other",
        shopify_order_name: "#MCRC100",
      })?.staffId,
    ).toBe(23);
    expect(
      findKairoConfirmation(x, 23, { order_name: "#MCRC1000" }),
    ).toBeNull();
    expect(findKairoConfirmation(x, 2, { order_name: "#MCRC100" })).toBeNull();
  });
});
