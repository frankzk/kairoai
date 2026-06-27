import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getIcomflyExternalStoreId,
  listConfiguredIcomflyStoreContexts,
  normalizeIcomflyOrder,
  resolveIcomflyStoreContext,
} from "../lib/icomfly";

const ORIGINAL_ENV = {
  ICOMFLY_STORE_ID: process.env.ICOMFLY_STORE_ID,
  ICOMFLY_CR_STORE_ID: process.env.ICOMFLY_CR_STORE_ID,
  ICOMFLY_HN_STORE_ID: process.env.ICOMFLY_HN_STORE_ID,
};

function resetIcomflyEnv() {
  delete process.env.ICOMFLY_STORE_ID;
  delete process.env.ICOMFLY_CR_STORE_ID;
  delete process.env.ICOMFLY_HN_STORE_ID;
}

beforeEach(resetIcomflyEnv);

afterEach(() => {
  resetIcomflyEnv();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value != null) process.env[key] = value;
  }
});

describe("iComfly store mapping", () => {
  it("keeps legacy ICOMFLY_STORE_ID as the Costa Rica external id", () => {
    process.env.ICOMFLY_STORE_ID = "71";

    const ctx = resolveIcomflyStoreContext({ store: "mireva-cr" });
    const legacyCtx = resolveIcomflyStoreContext({ storeId: 71 });

    expect(ctx.store.id).toBe(1);
    expect(ctx.store.code).toBe("mireva-cr");
    expect(ctx.externalStoreId).toBe(71);
    expect(legacyCtx.store.id).toBe(1);
    expect(legacyCtx.externalStoreId).toBe(71);
    expect(getIcomflyExternalStoreId("mireva-hn")).toBeNull();
  });

  it("resolves Honduras only when its own external iComfly id is configured", () => {
    process.env.ICOMFLY_HN_STORE_ID = "88";

    const ctx = resolveIcomflyStoreContext({ store: "mireva-hn" });

    expect(ctx.store.id).toBe(2);
    expect(ctx.store.code).toBe("mireva-hn");
    expect(ctx.externalStoreId).toBe(88);
  });

  it("lists only stores with configured iComfly external ids", () => {
    process.env.ICOMFLY_CR_STORE_ID = "71";
    process.env.ICOMFLY_HN_STORE_ID = "88";

    expect(listConfiguredIcomflyStoreContexts().map((ctx) => [ctx.store.code, ctx.externalStoreId])).toEqual([
      ["mireva-cr", 71],
      ["mireva-hn", 88],
    ]);
  });

  it("normalizes orders with Kairo's internal store id, not the external iComfly id", () => {
    const order = normalizeIcomflyOrder({ id: "abc", order_number: "MCRC10099" }, 1);

    expect(order.storeId).toBe(1);
    expect(order.icomflyOrderId).toBe("abc");
  });
});
