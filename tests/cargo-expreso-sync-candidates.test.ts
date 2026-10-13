// Que guias de Cargo Expreso consulta cada corrida del cron.

import { beforeEach, describe, expect, it, vi } from "vitest";

const tables: Record<string, Array<Record<string, unknown>>> = { shopify_orders: [], courier_shipments: [] };

// Doble encadenable de Supabase: los filtros no cambian el resultado, cada test
// controla las filas por tabla.
function fakeQuery(table: string) {
  const rows = [...(tables[table] ?? [])];
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    ilike: () => chain,
    is: () => chain,
    gte: () => chain,
    gt: () => chain,
    order: () => chain,
    range: (from: number, to: number) => {
      const page = { data: rows.slice(from, to + 1), error: null };
      // La consulta de courier_shipments agrega filtros despues de range.
      return Object.assign(Promise.resolve(page), { gt: () => Promise.resolve(page) });
    },
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDB: () => ({ from: (table: string) => fakeQuery(table) }),
}));

import { listCargoExpresoSyncCandidates } from "@/lib/finance";

const haceMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function leida(guide: string, min: number, group = "in_progress") {
  return {
    store_id: 2,
    guide_number: guide,
    normalized_status: group,
    raw_status: "",
    latest_at: null,
    has_incident: false,
    incident_reason: "",
    raw_payload: {},
    checked_at: haceMin(min),
  };
}

const OPTS = { limit: 10, freshWindowMinutes: 45, discoveryDays: 90 };

describe("listCargoExpresoSyncCandidates", () => {
  beforeEach(() => {
    tables.shopify_orders = [];
    tables.courier_shipments = [];
  });

  it("primero las nunca leidas, despues la que lleva mas tiempo sin leerse", async () => {
    tables.shopify_orders = ["BH000000001-1", "BH000000002-1", "BH000000003-1"].map((tracking_number) => ({ tracking_number }));
    tables.courier_shipments = [leida("BH000000001-1", 60), leida("BH000000002-1", 300)];
    expect(await listCargoExpresoSyncCandidates(2, OPTS)).toEqual(["BH000000003-1", "BH000000002-1", "BH000000001-1"]);
  });

  it("no relee las entregadas, las devueltas ni las leidas hace poco", async () => {
    tables.shopify_orders = ["BH000000001-1", "BH000000002-1", "BH000000003-1", "BH000000004-1"].map((tracking_number) => ({ tracking_number }));
    tables.courier_shipments = [
      leida("BH000000001-1", 600, "delivered"),
      leida("BH000000002-1", 600, "returned"),
      leida("BH000000003-1", 10, "failed"),
      leida("BH000000004-1", 600, "failed"),
    ];
    expect(await listCargoExpresoSyncCandidates(2, OPTS)).toEqual(["BH000000004-1"]);
  });

  it("ignora guias que no son de Cargo Expreso y respeta el tope", async () => {
    tables.shopify_orders = [{ tracking_number: "BH-sin-numero" }, { tracking_number: " bh000000005-1 " }, { tracking_number: "BH000000006-1" }];
    expect(await listCargoExpresoSyncCandidates(2, { ...OPTS, limit: 1 })).toHaveLength(1);
    expect(await listCargoExpresoSyncCandidates(2, OPTS)).toEqual(expect.arrayContaining(["BH000000005-1", "BH000000006-1"]));
  });
});
