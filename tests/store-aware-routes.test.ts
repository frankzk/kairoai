import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const upsertProductCost = vi.fn();

vi.mock("@/lib/finance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance")>()),
  upsertProductCost,
}));

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, init);
}

async function expectStoreRequired(response: Response): Promise<void> {
  expect(response.status).toBe(400);
  const json = await response.json();
  expect(json.error).toContain("store requerido");
}

describe("store-aware API route guards", () => {
  it("requires store for incidents list/detail", async () => {
    const route = await import("@/app/api/incidents/route");

    await expectStoreRequired(await route.GET(req("http://test.local/api/incidents")));
    await expectStoreRequired(await route.GET(req("http://test.local/api/incidents?id=1")));
  });

  it("requires store for incident writes/actions", async () => {
    const incidents = await import("@/app/api/incidents/route");
    const actions = await import("@/app/api/incidents/actions/route");

    await expectStoreRequired(
      await incidents.POST(
        req("http://test.local/api/incidents", {
          method: "POST",
          body: JSON.stringify({ order_name: "#MCRC1" }),
        })
      )
    );
    await expectStoreRequired(
      await incidents.PATCH(
        req("http://test.local/api/incidents", {
          method: "PATCH",
          body: JSON.stringify({ id: 1, status: "pendiente" }),
        })
      )
    );
    await expectStoreRequired(
      await actions.POST(
        req("http://test.local/api/incidents/actions", {
          method: "POST",
          body: JSON.stringify({ id: 1, action: "descartar" }),
        })
      )
    );
  });

  it("requires store for Forza sync/tracking routes", async () => {
    const sync = await import("@/app/api/finance/forza-sync/route");
    const tracking = await import("@/app/api/finance/forza-tracking/route");

    await expectStoreRequired(await sync.GET(req("http://test.local/api/finance/forza-sync")));
    await expectStoreRequired(
      await sync.POST(
        req("http://test.local/api/finance/forza-sync", {
          method: "POST",
          body: JSON.stringify({ guides: [{ guide: "FD123" }] }),
        })
      )
    );
    await expectStoreRequired(
      await tracking.GET(req("http://test.local/api/finance/forza-tracking?guide=FD123"))
    );
  });

  it("requires store for iComfly manual sync route", async () => {
    const route = await import("@/app/api/icomfly/sync/route");

    await expectStoreRequired(await route.GET(req("http://test.local/api/icomfly/sync")));
    await expectStoreRequired(
      await route.POST(
        req("http://test.local/api/icomfly/sync", {
          method: "POST",
          body: JSON.stringify({ max_pages: 1 }),
        })
      )
    );
  });

  it("requires store for bulk product costs and passes store id when present", async () => {
    const route = await import("@/app/api/finance/product-costs/bulk/route");

    await expectStoreRequired(
      await route.POST(
        req("http://test.local/api/finance/product-costs/bulk", {
          method: "POST",
          body: JSON.stringify({
            items: [{ sku: "ABC", unit_cost: 10 }],
          }),
        })
      )
    );

    upsertProductCost.mockResolvedValueOnce({ id: 1 });

    const ok = await route.POST(
      req("http://test.local/api/finance/product-costs/bulk", {
        method: "POST",
        body: JSON.stringify({
          store: "mireva-hn",
          items: [{ sku: "ABC", unit_cost: 10 }],
        }),
      })
    );
    expect(ok.status).toBe(200);
    expect(upsertProductCost).toHaveBeenCalledWith(
      expect.objectContaining({ sku: "ABC", unit_cost: 10 }),
      2
    );
  });
});

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walkFiles(full) : [full];
  });
}

describe("store-aware API audit", () => {
  it("does not use soft default-store helpers inside API routes", () => {
    const apiDir = path.join(process.cwd(), "app", "api");
    const offenders = walkFiles(apiDir)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /\bgetStoreFrom(?:SearchParams|Body)\b/.test(text);
      })
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
