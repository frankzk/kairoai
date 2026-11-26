// Marketing › Publicidad: la ruta valida tienda, rango, nivel e ids antes de
// leer nada, y solo expone GET.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cumple, exigenciaDe } from "../lib/permisos";

const mocks = vi.hoisted(() => ({
  store: { id: 71, code: "mireva-cr" } as { id: number; code: string } | null,
  meta: vi.fn(),
  tiktok: vi.fn(),
}));

vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: () => mocks.store,
}));
vi.mock("@/lib/marketing-publicidad-server", () => ({
  getPublicidadMeta: mocks.meta,
}));
vi.mock("@/lib/marketing-publicidad-tiktok", () => ({
  getPublicidadTiktok: mocks.tiktok,
}));

import * as route from "../app/api/marketing/publicidad/route";

const get = (query: string) =>
  route.GET(
    new NextRequest(`https://kairo.test/api/marketing/publicidad?${query}`),
  );
const base = "store=mireva-cr&from=2026-11-01&to=2026-11-07";

beforeEach(() => {
  mocks.store = { id: 71, code: "mireva-cr" };
  mocks.meta.mockReset().mockResolvedValue({ platform: "meta", rows: [] });
  mocks.tiktok.mockReset().mockResolvedValue({ platform: "tiktok", rows: [] });
});

describe("GET /api/marketing/publicidad", () => {
  it("es de solo lectura y la cubre el permiso de Marketing", () => {
    expect(Object.keys(route).filter((key) => /^[A-Z]+$/.test(key))).toEqual([
      "GET",
    ]);
    expect(route.maxDuration).toBe(60);
    expect(route.runtime).toBe("nodejs");
    const needs = exigenciaDe("/api/marketing/publicidad");
    expect(cumple(needs, ["marketing"])).toBe(true);
    expect(cumple(needs, ["finanzas"])).toBe(false);
    expect(cumple(needs, [])).toBe(false);
  });

  it("rechaza otra tienda, un rango inválido, un nivel o una plataforma desconocidos", async () => {
    mocks.store = { id: 3, code: "kenku-mx" };
    expect((await get(`${base}&level=campaign`)).status).toBe(400);
    mocks.store = null;
    expect((await get(`${base}&level=campaign`)).status).toBe(400);
    mocks.store = { id: 71, code: "mireva-cr" };
    expect(
      (await get("store=mireva-cr&from=2026-11-07&to=2026-11-01")).status,
    ).toBe(400);
    expect((await get("store=mireva-cr")).status).toBe(400);
    expect((await get(`${base}&level=account`)).status).toBe(400);
    expect((await get(`${base}&platform=google`)).status).toBe(400);
    expect(mocks.meta).not.toHaveBeenCalled();
    expect(mocks.tiktok).not.toHaveBeenCalled();
  });

  it("solo deja pasar ids numéricos hacia la consulta de Meta", async () => {
    for (const bad of [
      "campaign=1,2",
      "adset=abc",
      "account=act_12x",
      'campaign=1"]}',
    ])
      expect(
        (await get(`${base}&level=ad&${encodeURI(bad)}`)).status,
        bad,
      ).toBe(400);
    expect(mocks.meta).not.toHaveBeenCalled();
  });

  it("lee Meta con el nivel, el rango y los filtros; refresh=1 salta la caché", async () => {
    const response = await get(
      `${base}&level=ad&account=act_123&campaign=555&adset=777&refresh=1`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.meta).toHaveBeenCalledWith({
      store: "mireva-cr",
      level: "ad",
      from: "2026-11-01",
      to: "2026-11-07",
      account: "123",
      campaign: "555",
      adset: "777",
      refresh: true,
    });
    await get(base);
    expect(mocks.meta).toHaveBeenLastCalledWith({
      store: "mireva-cr",
      level: "campaign",
      from: "2026-11-01",
      to: "2026-11-07",
      account: undefined,
      campaign: undefined,
      adset: undefined,
      refresh: false,
    });
    expect(mocks.tiktok).not.toHaveBeenCalled();
  });

  it("TikTok sale de lo guardado por Make y un fallo de la base no filtra detalles", async () => {
    expect(
      (await get(`${base}&platform=tiktok&level=adset&campaign=9`)).status,
    ).toBe(200);
    expect(mocks.tiktok).toHaveBeenCalledWith(71, {
      level: "adset",
      from: "2026-11-01",
      to: "2026-11-07",
      account: undefined,
      campaign: "9",
      adset: undefined,
    });
    expect(mocks.meta).not.toHaveBeenCalled();
    mocks.tiktok.mockRejectedValueOnce(
      new Error("leerCuentasTiktok: relation secreta"),
    );
    const failed = await get(`${base}&platform=tiktok`);
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain("secreta");
  });

  it("Honduras lee sus propias cuentas de Meta y TikTok queda «no conectado» sin error", async () => {
    mocks.store = { id: 2, code: "mireva-hn" };
    const hn = "store=mireva-hn&from=2026-11-01&to=2026-11-07";
    expect((await get(`${hn}&level=campaign`)).status).toBe(200);
    expect(mocks.meta).toHaveBeenLastCalledWith(
      expect.objectContaining({ store: "mireva-hn", level: "campaign" }),
    );
    const tiktok = await get(`${hn}&platform=tiktok`);
    expect(tiktok.status).toBe(200);
    expect(await tiktok.json()).toMatchObject({
      platform: "tiktok",
      status: "pending",
      message: "TikTok Ads no está conectado para Honduras.",
      rows: [],
    });
    expect(mocks.tiktok).not.toHaveBeenCalled();
  });
});
