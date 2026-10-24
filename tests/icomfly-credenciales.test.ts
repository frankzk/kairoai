// Una clave de iComfly por tienda.
//
// POR QUE ESTE TEST EXISTE: Kairo usaba una sola clave (ICOMFLY_TOKEN) para
// las dos tiendas. Esa clave "ve" solo Costa Rica (tienda 71) y iComfly
// contesta con esa aunque se pida Honduras (tienda 90): desde julio Honduras
// recibio pedidos de Costa Rica y desde el 24/10 sus pedidos de la pagina web
// no llegaban a Kairo. Cada tienda tiene que poder usar su propia clave.

import { afterEach, describe, expect, it, vi } from "vitest";
import { credencialIcomfly, listOrdersWithAttribution } from "../lib/icomfly";

describe("qué clave usa cada tienda", () => {
  it("sin claves por tienda, las dos usan la compartida (como hasta hoy)", () => {
    const env = { ICOMFLY_TOKEN: "t-compartida" };
    expect(credencialIcomfly("mireva-cr", env)).toEqual({ origen: "ICOMFLY_TOKEN", token: "t-compartida" });
    expect(credencialIcomfly("mireva-hn", env)).toEqual({ origen: "ICOMFLY_TOKEN", token: "t-compartida" });
  });
  it("la clave de Honduras es solo para Honduras", () => {
    const env = { ICOMFLY_TOKEN: "t-cr", ICOMFLY_HN_TOKEN: "t-hn" };
    expect(credencialIcomfly("mireva-hn", env)).toEqual({ origen: "ICOMFLY_HN_TOKEN", token: "t-hn" });
    expect(credencialIcomfly("mireva-cr", env)).toEqual({ origen: "ICOMFLY_TOKEN", token: "t-cr" });
  });
  it("el correo y la contraseña de la tienda le ganan a la clave compartida", () => {
    const env = { ICOMFLY_TOKEN: "t-cr", ICOMFLY_HN_EMAIL: "hn@x.com", ICOMFLY_HN_PASSWORD: "p" };
    expect(credencialIcomfly("mireva-hn", env)).toEqual({ origen: "ICOMFLY_HN_EMAIL", email: "hn@x.com", password: "p" });
  });
  it("sin token, el login compartido", () => {
    const env = { ICOMFLY_EMAIL: "a@x.com", ICOMFLY_PASSWORD: "p" };
    expect(credencialIcomfly("mireva-cr", env)).toEqual({ origen: "ICOMFLY_EMAIL", email: "a@x.com", password: "p" });
  });
});

describe("cada pedido a la API va con la clave de su tienda", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Honduras con ICOMFLY_HN_TOKEN, Costa Rica con la de siempre", async () => {
    vi.stubEnv("ICOMFLY_TOKEN", "t-cr");
    vi.stubEnv("ICOMFLY_HN_TOKEN", "t-hn");
    const auth: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      auth.push(`${new URL(url).searchParams.get("store_id")}:${(init?.headers as Record<string, string>).Authorization}`);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    await listOrdersWithAttribution({ storeId: 2, externalStoreId: 90 });
    await listOrdersWithAttribution({ storeId: 1, externalStoreId: 71 });
    expect(auth).toEqual(["90:Bearer t-hn", "71:Bearer t-cr"]);
  });
});
