import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDB: () => ({ from: mocks.from }) }));
import {
  readOriginCatalog,
  rememberOriginCatalog,
} from "../lib/marketing-origin-catalog";
import type { MarketingSources } from "../lib/marketing-source-types";
const item = { platform: "meta", accountId: "777", campaignId: "123456789" };
function chain(results: unknown[]) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "insert", "update", "maybeSingle"])
    q[name] = vi.fn(() => q);
  q.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(results.shift()).then(resolve),
  );
  mocks.from.mockReturnValue(q);
  return q;
}
const sources = {
  meta: {
    status: "ready",
    data: {
      accounts: [{ accountId: "act_777", campaigns: [{ id: "123456789" }] }],
    },
  },
  tiktok: {
    status: "error",
    data: {
      accounts: [{ accountId: "999", campaigns: [{ id: "999999999" }] }],
    },
  },
} as MarketingSources;
beforeEach(() => vi.clearAllMocks());
describe("catálogo privado de campañas verificadas", () => {
  it("ignora registros malformados y acota la consulta por tienda y sección", async () => {
    const q = chain([
      {
        data: {
          payload: {
            entities: [
              item,
              { platform: "meta", accountId: "777", campaignId: 123456789 },
            ],
          },
        },
        error: null,
      },
    ]);
    expect(await readOriginCatalog(1)).toEqual([item]);
    expect(q.eq).toHaveBeenCalledWith("store_id", 1);
    expect(q.eq).toHaveBeenCalledWith(
      "section",
      "marketing_attribution_catalog",
    );
  });
  it("solo recuerda fuentes leídas correctamente y conserva campañas históricas", async () => {
    const historic = { ...item, campaignId: "888888888" };
    const q = chain([
      {
        data: { payload: { entities: [historic] }, refreshed_at: "old" },
        error: null,
      },
      { data: [{ store_id: 1 }], error: null },
    ]);
    await rememberOriginCatalog(1, sources);
    expect(q.update.mock.calls[0][0].payload.entities).toEqual([
      historic,
      item,
    ]);
    expect(q.eq).toHaveBeenCalledWith("refreshed_at", "old");
    expect(q.insert).not.toHaveBeenCalled();
  });
  it("relee tras una escritura concurrente para no borrar IDs guardados por otro período", async () => {
    const concurrent = { ...item, campaignId: "666666666" };
    const q = chain([
      { data: null, error: null },
      { error: { code: "23505" } },
      {
        data: { payload: { entities: [concurrent] }, refreshed_at: "new" },
        error: null,
      },
      { data: [{ store_id: 1 }], error: null },
    ]);
    await rememberOriginCatalog(1, sources);
    expect(q.update.mock.calls[0][0].payload.entities).toEqual([
      concurrent,
      item,
    ]);
    expect(q.eq).toHaveBeenCalledWith("refreshed_at", "new");
  });
});
