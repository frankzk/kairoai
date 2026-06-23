import { describe, expect, it } from "vitest";
import {
  buildIcomflyOrderRow,
  computeDispatchState,
  detectGuideFinal,
  isStandby,
  matchStaff,
  normalizePersonName,
  requestDateCR,
  DISPATCH_REQUEST_FIELD,
  type NormalizedIcomflyOrder,
  type StaffLike,
} from "../lib/dispatch";

function makeOrder(partial: Partial<NormalizedIcomflyOrder> = {}): NormalizedIcomflyOrder {
  return {
    storeId: 71,
    icomflyOrderId: "abc",
    orderNumber: "MCRC10099",
    shopifyDisplayNumber: "#MCRC10099",
    status: "",
    carrierName: "",
    trackingNumber: "",
    shippedAt: null,
    createdAt: "2026-06-22T08:00:00-06:00",
    attribution: {},
    ...partial,
  };
}

const staff: StaffLike[] = [
  { id: 1, name: "Leny Vargas", email: "leny@tienda.com", icomfly_user_id: 83 },
  { id: 2, name: "Daleska Mora", email: null, icomfly_user_id: null },
];

describe("normalizePersonName", () => {
  it("strips diacritics, case and extra spaces", () => {
    expect(normalizePersonName("  Daléska   Móra ")).toBe("daleska mora");
  });
});

describe("matchStaff", () => {
  it("matches by icomfly_user_id first", () => {
    expect(matchStaff({ userId: 83, name: "otro nombre", email: "x@y.com" }, staff)).toBe(1);
  });
  it("matches by email when no user_id match", () => {
    expect(matchStaff({ userId: 999, name: "no", email: "LENY@tienda.com" }, staff)).toBe(1);
  });
  it("matches by normalized name with accents", () => {
    expect(matchStaff({ userId: null, name: "daléska mora", email: "" }, staff)).toBe(2);
  });
  it("returns null when no match", () => {
    expect(matchStaff({ userId: null, name: "Persona Nueva", email: "" }, staff)).toBeNull();
  });
  it("returns null for missing actor", () => {
    expect(matchStaff(null, staff)).toBeNull();
  });
});

describe("detectGuideFinal", () => {
  it("flags final guide from tracking number (iComfly)", () => {
    const g = detectGuideFinal(makeOrder({ trackingNumber: "TRK123" }));
    expect(g.exists).toBe(true);
    expect(g.source).toBe("icomfly");
  });
  it("flags final guide from a shipped status", () => {
    expect(detectGuideFinal(makeOrder({ status: "Enviado" })).exists).toBe(true);
  });
  it("falls back to Boxful keys", () => {
    const boxful = new Set<string>(["mcrc10099"]);
    const g = detectGuideFinal(makeOrder(), boxful);
    expect(g.exists).toBe(true);
    expect(g.source).toBe("boxful");
  });
  it("returns false with no signal", () => {
    expect(detectGuideFinal(makeOrder()).exists).toBe(false);
  });
});

describe("computeDispatchState", () => {
  const noGuide = { exists: false, at: null, source: "" as const };
  it("is pendiente with no attribution and no guide", () => {
    expect(computeDispatchState(makeOrder(), noGuide)).toBe("pendiente");
  });
  it("is despacho_solicitado when request attribution present", () => {
    const order = makeOrder({
      attribution: { [DISPATCH_REQUEST_FIELD]: { userId: 83, name: "Leny", email: "", at: null } },
    });
    expect(computeDispatchState(order, noGuide)).toBe("despacho_solicitado");
  });
  it("is despachado when guide exists, regardless of attribution", () => {
    const order = makeOrder({
      attribution: { [DISPATCH_REQUEST_FIELD]: { userId: 83, name: "Leny", email: "", at: null } },
    });
    expect(computeDispatchState(order, { exists: true, at: null, source: "icomfly" })).toBe("despachado");
  });
});

describe("requestDateCR", () => {
  it("uses the request timestamp in Costa Rica time", () => {
    const order = makeOrder({
      attribution: { [DISPATCH_REQUEST_FIELD]: { userId: 1, name: "x", email: "", at: "2026-06-22T03:30:00Z" } },
    });
    // 03:30 UTC == 21:30 del 21 de junio en CR (UTC-6)
    expect(requestDateCR(order)).toBe("2026-06-21");
  });
});

describe("isStandby", () => {
  const requested = makeOrder({
    attribution: { [DISPATCH_REQUEST_FIELD]: { userId: 1, name: "x", email: "", at: "2026-06-22T14:00:00-06:00" } },
  });
  it("not standby before the 15:00 cutoff on the same day", () => {
    const now = new Date("2026-06-22T14:30:00-06:00");
    expect(isStandby(requested, "despacho_solicitado", now)).toBe(false);
  });
  it("standby after the 15:00 cutoff on the same day", () => {
    const now = new Date("2026-06-22T15:30:00-06:00");
    expect(isStandby(requested, "despacho_solicitado", now)).toBe(true);
  });
  it("standby for a previous-day request still without final guide", () => {
    const now = new Date("2026-06-23T09:00:00-06:00");
    expect(isStandby(requested, "despacho_solicitado", now)).toBe(true);
  });
  it("never standby once despachado", () => {
    const now = new Date("2026-06-23T09:00:00-06:00");
    expect(isStandby(requested, "despachado", now)).toBe(false);
  });
});

describe("buildIcomflyOrderRow", () => {
  it("assembles a row with attribution matched to planilla", () => {
    const order = makeOrder({
      attribution: {
        confirmo: { userId: 2, name: "Daleska Mora", email: "", at: "2026-06-22T09:00:00-06:00" },
        [DISPATCH_REQUEST_FIELD]: { userId: 83, name: "Leny Vargas", email: "", at: "2026-06-22T10:00:00-06:00" },
      },
    });
    const row = buildIcomflyOrderRow(order, { staff, now: new Date("2026-06-22T16:00:00-06:00") });
    expect(row.dispatch_state).toBe("despacho_solicitado");
    expect(row.is_standby).toBe(true);
    expect(row.confirmed_by_staff_id).toBe(2);
    expect(row.requested_by_staff_id).toBe(1);
    expect(row.confirmed_by_name).toBe("Daleska Mora");
  });

  it("marks despachado when a final guide exists and clears standby", () => {
    const order = makeOrder({
      trackingNumber: "TRK-9",
      attribution: { [DISPATCH_REQUEST_FIELD]: { userId: 83, name: "Leny Vargas", email: "", at: "2026-06-20T10:00:00-06:00" } },
    });
    const row = buildIcomflyOrderRow(order, { staff, now: new Date("2026-06-22T16:00:00-06:00") });
    expect(row.dispatch_state).toBe("despachado");
    expect(row.is_standby).toBe(false);
    expect(row.guide_final_source).toBe("icomfly");
  });
});
