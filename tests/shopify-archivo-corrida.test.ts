// Corrida del respaldo de Shopify contra una base y un Shopify simulados.
//
// POR QUE ESTE TEST EXISTE: el 28/10/2026 Shopify cierra en las cinco tiendas y
// el respaldo no se puede probar contra ellas antes. Lo que se rompe sin que
// nadie lo vea: un recurso con padre que se salta padres o se queda pegado en
// uno borrado; un permiso que falta y frena a los demas recursos; un recurso
// que se vuelve a pedir entero cada 5 minutos; una tienda Kenku sin app que
// tumba la corrida.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Fila = Record<string, unknown>;
const tablas: Record<string, Fila[]> = {};

// supabase-js en memoria: lo justo que usa lib/shopify-archivo.ts.
vi.mock("@/lib/db", () => {
  const leer = (fila: Fila, ruta: string): unknown => {
    // "payload->image->>src" -> fila.payload.image.src
    const [base, ...partes] = ruta.split(/->>?/);
    return partes.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Fila)[k] : undefined), fila[base]);
  };
  const proyectar = (fila: Fila, columnas: string): Fila => {
    const out: Fila = {};
    for (const col of columnas.split(",").map((c) => c.trim())) {
      const [alias, ruta] = col.includes(":") ? col.split(":") : [col, col];
      out[alias] = leer(fila, ruta);
    }
    return out;
  };
  const tabla = (nombre: string) => {
    const filtros: Array<(f: Fila) => boolean> = [];
    let columnas = "";
    let rango: [number, number] | null = null;
    let una = false;
    let upsert: { filas: Fila[]; claves: string[] } | null = null;
    const correr = () => {
      const filas = (tablas[nombre] ??= []);
      if (upsert) {
        for (const nueva of upsert.filas) {
          const i = filas.findIndex((f) => upsert!.claves.every((k) => String(f[k]) === String(nueva[k])));
          if (i >= 0) filas[i] = { ...filas[i], ...nueva };
          else filas.push({ ...nueva });
        }
        return { data: null, error: null };
      }
      let elegidas = filas.filter((f) => filtros.every((ok) => ok(f)));
      if (una) return { data: elegidas[0] ? { ...elegidas[0] } : null, error: null };
      if (rango) elegidas = elegidas.slice(rango[0], rango[1] + 1);
      return { data: elegidas.map((f) => proyectar(f, columnas)), error: null };
    };
    const api: Record<string, unknown> = {
      select: (c: string) => ((columnas = c), api),
      eq: (col: string, v: unknown) => (filtros.push((f) => String(f[col]) === String(v)), api),
      in: (col: string, vs: unknown[]) => (filtros.push((f) => vs.includes(f[col])), api),
      order: () => api,
      range: (a: number, b: number) => ((rango = [a, b]), api),
      maybeSingle: () => ((una = true), api),
      upsert: (filas: Fila | Fila[], opts: { onConflict: string }) => (
        (upsert = { filas: Array.isArray(filas) ? filas : [filas], claves: opts.onConflict.split(",") }), api
      ),
      then: (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) => Promise.resolve(correr()).then(ok, mal),
    };
    return api;
  };
  return { getDB: () => ({ from: tabla, storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) };
});

// Shopify simulado: cada ruta responde lo que diga `respuestas`; lo demas, lista vacia.
const pedidas: string[] = [];
let respuestas: Record<string, { status?: number; body?: unknown; link?: string; demoraMs?: number }> = {};
vi.mock("@/lib/shopify-sync", () => ({
  PAGE_DELAY_MS: 0,
  sleep: async () => {},
  fetchShopifyPage: async (url: string) => {
    const u = new URL(url);
    const clave = `${u.pathname.replace("/admin/api/2024-01/", "").replace(".json", "")}${u.searchParams.has("page_info") ? `?page_info=${u.searchParams.get("page_info")}` : ""}${u.searchParams.has("location_ids") ? `?location_ids=${u.searchParams.get("location_ids")}` : ""}`;
    pedidas.push(clave);
    const r = respuestas[clave];
    if (r?.demoraMs) await new Promise((ok) => setTimeout(ok, r.demoraMs));
    const status = r?.status ?? 200;
    const nombre = clave.split("?")[0].split("/").pop()!;
    const body = r?.body ?? (nombre === "shop" ? { shop: { id: 1 } } : { [nombre]: [] });
    return new Response(JSON.stringify(body), { status, headers: r?.link ? { link: r.link } : {} });
  },
}));

const TIENDA = {
  id: 3,
  code: "kenku-mx",
  label: "Kenku México",
  shopDomainEnv: "T_SHOP",
  accessTokenEnv: "T_TOKEN",
  clientIdEnv: "T_ID",
  clientSecretEnv: "T_SECRET",
};

const estado = (recurso: string) =>
  (tablas.shopify_archivo_estado ?? []).find((f) => f.store_id === 3 && f.recurso === recurso) as Fila | undefined;
const archivados = (recurso: string) =>
  (tablas.shopify_archivo ?? []).filter((f) => f.store_id === 3 && f.recurso === recurso).map((f) => f.shopify_id);

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  pedidas.length = 0;
  respuestas = {};
  process.env.T_SHOP = "kenku-mx.myshopify.com";
  process.env.T_TOKEN = "shpat_test";
});

describe("recursos que cuelgan de otro", () => {
  it("recorre cada padre en orden, sigue la paginación y salta el padre borrado", async () => {
    const { archivarRecurso } = await import("../lib/shopify-archivo");
    tablas.shopify_archivo = [
      { store_id: 3, recurso: "blog", shopify_id: "10" },
      { store_id: 3, recurso: "blog", shopify_id: "2" },
      { store_id: 3, recurso: "blog", shopify_id: "7" },
    ];
    tablas.shopify_archivo_estado = [{ store_id: 3, recurso: "blog", completo: true, next_url: null }];
    const link = `<https://kenku-mx.myshopify.com/admin/api/2024-01/blogs/2/articles.json?limit=250&page_info=p2>; rel="next"`;
    respuestas = {
      "blogs/2/articles": { body: { articles: [{ id: 21, blog_id: 2 }] }, link },
      "blogs/2/articles?page_info=p2": { body: { articles: [{ id: 22, blog_id: 2 }] } },
      "blogs/7/articles": { status: 404, body: { errors: "Not Found" } },
      "blogs/10/articles": { body: { articles: [{ id: 101, blog_id: 10 }] } },
    };
    const r = await archivarRecurso(TIENDA, "kenku-mx.myshopify.com", "article", Date.now() + 10_000);
    expect(pedidas).toEqual(["blogs/2/articles", "blogs/2/articles?page_info=p2", "blogs/7/articles", "blogs/10/articles"]);
    expect(archivados("article")).toEqual(["21", "22", "101"]);
    expect(r).toMatchObject({ completo: true, pendiente: false, filas: 3 });
    expect(estado("article")).toMatchObject({ completo: true, next_url: null, padre_actual: null, archivados: 3 });
  });

  it("si se acaba el tiempo a mitad, la corrida siguiente sigue en el mismo padre", async () => {
    const { archivarRecurso } = await import("../lib/shopify-archivo");
    tablas.shopify_archivo = [
      { store_id: 3, recurso: "location", shopify_id: "31" },
      { store_id: 3, recurso: "location", shopify_id: "32" },
    ];
    tablas.shopify_archivo_estado = [{ store_id: 3, recurso: "location", completo: true, next_url: null }];
    // El cursor de Shopify no lleva location_ids: la bodega sale de padre_actual.
    const link = `<https://kenku-mx.myshopify.com/admin/api/2024-01/inventory_levels.json?limit=250&page_info=q2>; rel="next"`;
    respuestas = {
      // Tarda mas que el tiempo de la corrida: queda a mitad.
      "inventory_levels?location_ids=31": { body: { inventory_levels: [{ inventory_item_id: 1, location_id: 31 }] }, link, demoraMs: 40 },
      "inventory_levels?page_info=q2": { body: { inventory_levels: [{ inventory_item_id: 2, location_id: 31 }] } },
      "inventory_levels?location_ids=32": { body: { inventory_levels: [{ inventory_item_id: 1, location_id: 32 }] } },
    };
    const primera = await archivarRecurso(TIENDA, "kenku-mx.myshopify.com", "inventory_level", Date.now() + 20);
    expect(primera.pendiente).toBe(true);
    expect(pedidas).toEqual(["inventory_levels?location_ids=31"]);
    respuestas["inventory_levels?location_ids=31"].demoraMs = 0;
    expect(estado("inventory_level")).toMatchObject({ padre_actual: "31", completo: false });

    await archivarRecurso(TIENDA, "kenku-mx.myshopify.com", "inventory_level", Date.now() + 10_000);
    expect(archivados("inventory_level")).toEqual(["1:31", "2:31", "1:32"]);
    expect(estado("inventory_level")).toMatchObject({ completo: true, padre_actual: null });
  });

  it("espera a que su padre esté entero", async () => {
    const { archivarRecurso } = await import("../lib/shopify-archivo");
    tablas.shopify_archivo_estado = [{ store_id: 3, recurso: "product", completo: false, next_url: "https://x" }];
    const r = await archivarRecurso(TIENDA, "kenku-mx.myshopify.com", "product_metafield", Date.now() + 10_000);
    expect(r.saltado).toBe(true);
    expect(pedidas).toEqual([]);
  });
});

describe("una corrida de tienda", () => {
  it("un permiso que falta anota su error y los demás recursos siguen", async () => {
    const { archivarTienda } = await import("../lib/shopify-archivo");
    respuestas = {
      orders: { body: { orders: [{ id: 1001, updated_at: "2026-10-25T10:00:00Z" }] } },
      price_rules: { status: 403, body: { errors: "[API] This action requires merchant approval for read_price_rules scope." } },
    };
    const r = await archivarTienda(TIENDA, Date.now() + 20_000);
    const precio = r.recursos.find((x) => x.recurso === "price_rule");
    expect(precio?.error).toContain("403");
    expect(estado("price_rule")?.ultimo_error).toContain("read_price_rules");
    // Lo que viene despues de los descuentos tambien se respaldo.
    expect(estado("draft_order")).toMatchObject({ completo: true });
    expect(estado("shop")).toMatchObject({ completo: true });
    expect(archivados("order")).toEqual(["1001"]);
    expect(archivados("shop")).toEqual(["1"]);
    // El 403 no se reintenta en la misma corrida.
    expect(pedidas.filter((p) => p === "price_rules")).toHaveLength(1);
  });

  it("lo que no filtra por fecha no se vuelve a pedir en cada corrida", async () => {
    const { archivarTienda } = await import("../lib/shopify-archivo");
    await archivarTienda(TIENDA, Date.now() + 20_000);
    expect(pedidas).toContain("redirects");
    expect(pedidas).toContain("orders");
    pedidas.length = 0;
    await archivarTienda(TIENDA, Date.now() + 20_000);
    expect(pedidas).not.toContain("redirects");
    expect(pedidas).not.toContain("policies");
    // Lo incremental si: trae lo que cambio.
    expect(pedidas).toContain("orders");
    expect(pedidas).toContain("checkouts");
  });

  it("una tienda sin app todavía no rompe nada: dice qué falta", async () => {
    const { archivarTienda } = await import("../lib/shopify-archivo");
    delete process.env.T_TOKEN;
    const r = await archivarTienda(TIENDA, Date.now() + 20_000);
    expect(r).toEqual({ store: "kenku-mx", recursos: [], error: "Faltan T_TOKEN (o T_ID y T_SECRET)" });
    expect(pedidas).toEqual([]);
  });
});
