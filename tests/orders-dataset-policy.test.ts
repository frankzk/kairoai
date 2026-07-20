import { describe, expect, it } from "vitest";

import { decideDatasetLoad } from "../app/api/finance/_shared/orders-dataset-policy";

describe("orders dataset load policy", () => {
  it("builds only after a confirmed L2 miss", () => {
    expect(decideDatasetLoad("miss", false)).toBe("build");
    expect(decideDatasetLoad("error", false)).toBe("unavailable");
  });

  it("serves stale L1 when L2 fails", () => {
    expect(decideDatasetLoad("error", true)).toBe("use-stale-l1");
  });

  it("uses L2 hits regardless of L1", () => {
    expect(decideDatasetLoad("hit", false)).toBe("use-l2");
    expect(decideDatasetLoad("hit", true)).toBe("use-l2");
  });
});
