import { describe, expect, it, vi } from "vitest";
import {
  ageGenderRows,
  metaAccountStatus,
  readMetaAccountStatuses,
  readMetaAgeGender,
} from "../lib/marketing-meta-accounts";

const env = {
  META_CR_AD_ACCOUNT_IDS: "111,222,333",
  META_CR_GRAPH_VERSION: "v26.0",
  META_CR_ACCESS_TOKEN: "private-fixture",
};

describe("metaAccountStatus", () => {
  it.each([
    [1, "activa"],
    [2, "deshabilitada"],
    [3, "pago_pendiente"],
    [7, "en_revision"],
    [8, "pago_pendiente"],
    [9, "periodo_gracia"],
    [100, "cerrada"],
    [101, "cerrada"],
    [42, "error"],
  ])("account_status %i → %s", (code, state) => {
    expect(
      metaAccountStatus("111", { id: "act_111", account_status: code }, 200)
        .state,
    ).toBe(state);
  });

  it("converts minor units and treats a zero cap as no cap", () => {
    expect(
      metaAccountStatus(
        "111",
        {
          id: "act_111",
          name: "Jam mini vlog CR3",
          account_status: 2,
          disable_reason: 3,
          currency: "USD",
          amount_spent: "123456",
          spend_cap: "0",
        },
        200,
      ),
    ).toEqual({
      accountId: "111",
      name: "Jam mini vlog CR3",
      state: "deshabilitada",
      statusCode: 2,
      disableReason: 3,
      currency: "USD",
      amountSpent: 1234.56,
      spendCap: null,
    });
    expect(
      metaAccountStatus(
        "111",
        { id: "act_111", account_status: 1, spend_cap: "50000" },
        200,
      ).spendCap,
    ).toBe(500);
  });

  it("maps permission errors to sin_acceso and never keeps provider text", () => {
    const denied = metaAccountStatus(
      "111",
      { error: { code: 200, message: "private provider detail for act_111" } },
      400,
    );
    expect(denied.state).toBe("sin_acceso");
    expect(JSON.stringify(denied)).not.toContain("private");
    expect(
      metaAccountStatus("111", { error: { code: 1, message: "x" } }, 500).state,
    ).toBe("error");
    expect(metaAccountStatus("111", { id: "act_999" }, 200).state).toBe(
      "error",
    );
    expect(metaAccountStatus("111", null, 0).state).toBe("error");
  });
});

describe("readMetaAccountStatuses", () => {
  it("reads each account independently: one failure does not hide the others", async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(String(input)).not.toContain(env.META_CR_ACCESS_TOKEN);
        expect(init?.headers).toEqual({
          Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}`,
        });
        expect(url.searchParams.get("fields")).toContain("account_status");
        if (url.pathname.endsWith("act_111"))
          return Response.json({
            id: "act_111",
            account_status: 1,
            currency: "USD",
          });
        if (url.pathname.endsWith("act_222"))
          return Response.json(
            { error: { code: 190, message: "private token detail" } },
            { status: 400 },
          );
        throw new Error("network private detail");
      },
    );
    const result = await readMetaAccountStatuses(env, fetcher);
    expect(result?.map((a) => [a.accountId, a.state])).toEqual([
      ["111", "activa"],
      ["222", "sin_acceso"],
      ["333", "error"],
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("returns null without configuration", async () => {
    const fetcher = vi.fn();
    expect(await readMetaAccountStatuses({}, fetcher)).toBeNull();
    expect(
      await readMetaAccountStatuses(
        { ...env, META_CR_AD_ACCOUNT_IDS: "abc" },
        fetcher,
      ),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("age and gender", () => {
  it("normalizes rows with the same purchase rule as the sources", () => {
    expect(
      ageGenderRows("111", "USD", [
        {
          age: "25-34",
          gender: "female",
          spend: "40.5",
          actions: [
            { action_type: "omni_purchase", value: "3" },
            { action_type: "purchase", value: "3" },
          ],
        },
        { age: "25-34", gender: "female", spend: "1.5", actions: [] },
        { age: "18-24", gender: "unknown", spend: "2" },
        { age: "", gender: "x", spend: "0" },
      ]),
    ).toEqual([
      {
        accountId: "111",
        currency: "USD",
        age: "18-24",
        gender: "unknown",
        spend: 2,
        purchases: 0,
      },
      {
        accountId: "111",
        currency: "USD",
        age: "25-34",
        gender: "female",
        spend: 42,
        purchases: 3,
      },
      {
        accountId: "111",
        currency: "USD",
        age: "Desconocida",
        gender: "unknown",
        spend: 0,
        purchases: 0,
      },
    ]);
    expect(() => ageGenderRows("111", "USD", [{ spend: "abc" }])).toThrow();
  });

  it("lists failing accounts and keeps the others", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("act_111"))
        return Response.json({ id: "act_111", currency: "CRC" });
      if (url.pathname.endsWith("act_111/insights")) {
        expect(url.searchParams.get("breakdowns")).toBe("age,gender");
        expect(url.searchParams.get("level")).toBe("account");
        expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({
          since: "2026-10-29",
          until: "2026-11-04",
        });
        return Response.json({
          data: [{ age: "35-44", gender: "male", spend: "5000", actions: [] }],
        });
      }
      return Response.json({ error: { code: 200 } }, { status: 400 });
    });
    const result = await readMetaAgeGender(
      env,
      fetcher,
      "2026-10-29",
      "2026-11-04",
    );
    expect(result).toEqual({
      configured: true,
      failed: ["222", "333"],
      rows: [
        {
          accountId: "111",
          currency: "CRC",
          age: "35-44",
          gender: "male",
          spend: 5000,
          purchases: 0,
        },
      ],
    });
  });
});
