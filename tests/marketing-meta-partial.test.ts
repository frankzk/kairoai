import { describe, expect, it } from "vitest";
import { metaAccountFailure, metaAccountsSettled } from "@/lib/marketing-sources";
import type { MarketingAdsData } from "@/lib/marketing-source-types";

const cuenta = (id: string): MarketingAdsData => ({ accountId: id, currency: "USD", timezone: "America/Costa_Rica", campaigns: [] });

describe("metaAccountsSettled", () => {
  it("una cuenta caída no borra las demás y queda listada", async () => {
    const r = await metaAccountsSettled(["1", "2", "3"], async (id) => {
      if (id === "2") throw new Error("Provider HTTP error 400");
      return cuenta(id);
    });
    expect(r.accounts.map((a) => a.accountId)).toEqual(["1", "3"]);
    expect(r.unavailable).toEqual([{ accountId: "2", reason: expect.stringContaining("no permite leer la cuenta") }]);
  });

  it("todas bien: sin unavailable", async () => {
    const r = await metaAccountsSettled(["1"], async (id) => cuenta(id));
    expect(r).toEqual({ accounts: [cuenta("1")] });
  });

  it("todas caídas: error (la fuente queda en error como antes)", async () => {
    await expect(metaAccountsSettled(["1", "2"], async () => { throw new Error("Provider HTTP error 401"); })).rejects.toThrow();
  });
});

describe("metaAccountFailure", () => {
  it("no repite el texto del proveedor", () => {
    expect(metaAccountFailure(new Error("Provider HTTP error 401"))).toBe("El token de Meta venció o no es válido.");
    expect(metaAccountFailure(new Error("Invalid Meta account"))).toContain("desactivada");
    expect(metaAccountFailure(new Error("access_token=SECRET leaked"))).toBe("Respuesta incompleta o inesperada de Meta.");
  });
});
