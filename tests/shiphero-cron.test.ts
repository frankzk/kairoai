import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron-runs", () => ({
  withCronRun: (_name: string, handler: () => Promise<Response>) => handler,
}));
vi.mock("@/lib/stores", () => ({
  getStoreConfig: () => ({ id: 1, code: "mireva-cr" }),
}));
vi.mock("@/lib/marketing-catalog-loader", () => ({
  marketingCatalogLoader: () => async () => null,
}));
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("./helpers/shiphero-fake-db");
  return { getDB: () => fakeDb.db };
});

import { baseRow, fakeDb } from "./helpers/shiphero-fake-db";
import { loadSecretKey, sealSecret } from "../lib/secret-box";
import { GET } from "../app/api/cron/shiphero-inventario/route";

const KEY = Buffer.alloc(32, 6).toString("base64");
const fetcher = vi.fn();
const connected = () =>
  baseRow({
    refresh_token_enc: sealSecret("refresh-token-0123456789", {
      ...loadSecretKey({ SHIPHERO_TOKEN_KEY: KEY }, "SHIPHERO_TOKEN_KEY"),
      aad: "shiphero:1:refresh",
    }),
  });

beforeEach(() => {
  fakeDb.reset();
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("SHIPHERO_TOKEN_KEY", KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cron shiphero-inventario", () => {
  it("without a connection (or without the migration) it is ok and does nothing", async () => {
    let res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "sin_conexion" });
    fakeDb.state.missingTable = true;
    res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: "sin_conexion" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a held lease is ok (another run is working)", async () => {
    fakeDb.state.row = connected();
    fakeDb.state.rpc.set("marketing_shiphero_lease", () => ({ data: null, error: null }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "ocupado" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a connection without the key fails loudly (502, ok:false)", async () => {
    vi.stubEnv("SHIPHERO_TOKEN_KEY", "");
    fakeDb.state.row = connected();
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: "Pendiente: configurar SHIPHERO_TOKEN_KEY." });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
