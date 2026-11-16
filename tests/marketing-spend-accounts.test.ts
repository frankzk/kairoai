import { describe, expect, it } from "vitest";
import { buildSpendByAccount, spendDates } from "@/lib/marketing-spend-accounts";
import type { MarketingSources } from "@/lib/marketing-source-types";

const fx = { rate: 500, date: "2026-11-16", source: "hacienda" as const, checkedAt: "", message: "", pen: { rate: 3.75 } } as never;
const camp = (id: string, spend: number, daily?: Array<{ date: string; spend: number }>) => ({
  id, name: id, spend, impressions: 0, clicks: 0,
  ...(daily ? { daily: daily.map((d) => ({ ...d, impressions: 0, clicks: 0, purchases: 0 })) } : {}),
});
const ready = <T,>(data: T) => ({ status: "ready" as const, checkedAt: "", message: "", data });

describe("gasto por cuenta publicitaria", () => {
  const sources = {
    meta: ready({
      accounts: [
        { accountId: "1", accountName: "CR2", currency: "USD", timezone: "America/Costa_Rica", campaigns: [camp("a", 10, [{ date: "2026-11-14", spend: 4 }, { date: "2026-11-15", spend: 6 }]), camp("b", 0)] },
        { accountId: "2", accountName: "Madre", currency: "USD", timezone: "America/Costa_Rica", campaigns: [camp("c", 30, [{ date: "2026-11-15", spend: 30 }])] },
      ],
      unavailable: [{ accountId: "3", reason: "Sin acceso" }],
    }),
    tiktok: ready({ accounts: [{ accountId: "9", accountName: "TikTok CR", currency: "PEN", timezone: "America/Lima", campaigns: [camp("t", 75)] }] }),
    shiphero: ready(null),
  } as unknown as MarketingSources;

  it("una fila por cuenta, en su moneda y en USD, y la cuenta caída aparte", () => {
    const { rows, totalUsd } = buildSpendByAccount(sources, fx, { from: "2026-11-14", to: "2026-11-15" });
    expect(rows.map((r) => r.accountName)).toEqual(["Madre", "CR2", "3", "TikTok CR"]);
    expect(rows[1]).toMatchObject({ spend: 10, spendUsd: 10, campaigns: 2, activeCampaigns: 1 });
    expect(rows[1].days).toEqual([{ date: "2026-11-14", spend: 4 }, { date: "2026-11-15", spend: 6 }]);
    expect(rows[2]).toMatchObject({ spend: null, problem: "Sin acceso" });
    expect(rows[3]).toMatchObject({ spend: 75, spendUsd: 20, days: null });
    expect(totalUsd).toBeNull();
    expect(spendDates(rows)).toEqual(["2026-11-14", "2026-11-15"]);
    const { subtotals } = buildSpendByAccount(sources, fx, { from: "2026-11-14", to: "2026-11-15" });
    expect(subtotals).toEqual([
      { platform: "meta", currency: "USD", spend: 40, spendUsd: 40, complete: false },
      { platform: "tiktok", currency: "PEN", spend: 75, spendUsd: 20, complete: true },
    ]);
  });

  it("suma el total en USD solo cuando todas las cuentas se leyeron", () => {
    const ok = { ...sources, meta: ready({ accounts: (sources.meta.data as { accounts: unknown[] }).accounts }) } as unknown as MarketingSources;
    expect(buildSpendByAccount(ok, fx, { from: "2026-11-14", to: "2026-11-15" }).totalUsd).toBe(60);
  });

  it("marca pendiente o error por plataforma", () => {
    const s = { meta: { status: "pending" }, tiktok: { status: "error", message: "Make no envió datos", data: null } } as unknown as MarketingSources;
    const r = buildSpendByAccount(s, fx, { from: "2026-11-14", to: "2026-11-15" });
    expect(r.pending).toBe(true);
    expect(r.rows[0]).toMatchObject({ platform: "tiktok", problem: "Make no envió datos" });
  });
});
