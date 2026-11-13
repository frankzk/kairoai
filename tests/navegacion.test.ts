import { describe, expect, it } from "vitest";
import { itemActivo, menuDe, tiendaActual, tiendasDe } from "../lib/navegacion";
import { PERMISOS } from "../lib/permisos";

const admin = {
  id: 0,
  permisos: [...PERMISOS],
  tiendas: ["mireva-cr", "mireva-hn"],
};
const labels = (g: ReturnType<typeof menuDe>) =>
  g.map((x) => [x.label, x.items.map((i) => i.label)]);

describe("tiendasDe", () => {
  it("lists Mireva stores first, then the Kenku stores the person can work", () => {
    expect(tiendasDe(admin).map((t) => t.label)).toEqual([
      "Mireva Costa Rica",
      "Mireva Honduras",
      "Kenku Italia",
      "Kenku México",
      "Kenku Argentina",
    ]);
  });
  it("keeps an advisor to her own store and no Kenku", () => {
    expect(
      tiendasDe({ id: 7, permisos: ["leads"], tiendas: ["mireva-hn"] }).map(
        (t) => t.code,
      ),
    ).toEqual(["mireva-hn"]);
  });
  it("gives Kenku only with orders or finance and the store", () => {
    expect(
      tiendasDe({ id: 3, permisos: ["pedidos"], tiendas: ["mireva-cr", "kenku-mx"] }).map(
        (t) => t.code,
      ),
    ).toEqual(["mireva-cr", "kenku-mx"]);
  });
});

describe("tiendaActual", () => {
  const tiendas = tiendasDe(admin);
  it("follows the Kenku route, Marketing (Costa Rica) and otherwise the chosen store", () => {
    expect(tiendaActual(tiendas, "/admin/finance/italia/costos", "mireva-hn")?.code).toBe("kenku-it");
    expect(tiendaActual(tiendas, "/admin/marketing", "mireva-hn")?.code).toBe("mireva-cr");
    expect(tiendaActual(tiendas, "/admin/finance", "mireva-hn")?.code).toBe("mireva-hn");
    expect(tiendaActual(tiendas, "/admin/finance", "nada")?.code).toBe("mireva-cr");
  });
});

describe("menuDe", () => {
  it("groups a Mireva Costa Rica admin's sections by work, Panel first", () => {
    const tienda = tiendaActual(tiendasDe(admin), "/", "mireva-cr");
    expect(labels(menuDe(admin, tienda))).toEqual([
      ["Operación", ["Panel", "Leads", "Novedades", "Gestión de pedidos"]],
      ["Crecimiento", ["Marketing", "Upsells"]],
      ["Ajustes", ["Configuración", "Usuarios"]],
    ]);
  });

  it("hides Marketing for Honduras", () => {
    const tienda = tiendaActual(tiendasDe(admin), "/admin/leads", "mireva-hn");
    expect(labels(menuDe(admin, tienda))[1]).toEqual(["Crecimiento", ["Upsells"]]);
  });

  it("shows a Kenku store's own orders screen instead of the Mireva sections", () => {
    const tienda = tiendaActual(tiendasDe(admin), "/admin/finance/mexico", "mireva-cr");
    expect(menuDe(admin, tienda)).toEqual([
      {
        key: "operacion",
        label: "Operación",
        items: [{ ruta: "/admin/finance/mexico", label: "Pedidos", icono: "gestion" }],
      },
      {
        key: "ajustes",
        label: "Ajustes",
        items: [
          { ruta: "/admin/settings", label: "Configuración", icono: "config" },
          { ruta: "/admin/usuarios", label: "Usuarios", icono: "usuarios" },
        ],
      },
    ]);
  });

  it("shows an advisor only Leads, with no empty groups", () => {
    expect(menuDe({ id: 7, permisos: ["leads"], tiendas: ["mireva-cr"] })).toEqual([
      {
        key: "operacion",
        label: "Operación",
        items: [{ ruta: "/admin/leads", label: "Leads", icono: "leads" }],
      },
    ]);
  });

  it("hides Marketing without the Mireva Costa Rica store", () => {
    const grupos = menuDe({ id: 3, permisos: ["marketing", "pedidos"], tiendas: ["mireva-hn"] });
    expect(grupos.flatMap((g) => g.items.map((i) => i.label))).toEqual(["Gestión de pedidos"]);
  });
});

describe("itemActivo", () => {
  const grupos = menuDe(admin, tiendaActual(tiendasDe(admin), "/", "mireva-cr"));
  it("picks the longest matching route", () => {
    expect(itemActivo(grupos, "/admin/finance/italia/costos")).toBe("/admin/finance");
    expect(itemActivo(grupos, "/admin/marketing")).toBe("/admin/marketing");
  });
  it("keeps Panel exact and ignores look-alike prefixes", () => {
    expect(itemActivo(grupos, "/")).toBe("/");
    expect(itemActivo(grupos, "/cuenta")).toBeNull();
    expect(itemActivo(grupos, "/admin/financeX")).toBeNull();
  });
  it("marks a Kenku store's Pedidos on its sub-pages", () => {
    const kenku = menuDe(admin, tiendaActual(tiendasDe(admin), "/admin/finance/italia", "mireva-cr"));
    expect(itemActivo(kenku, "/admin/finance/italia/costos")).toBe("/admin/finance/italia");
  });
});

describe("Kenku-only person", () => {
  it("does not get Mireva stores and lands on her Kenku store", () => {
    const yo = { id: 9, permisos: ["pedidos" as const], tiendas: ["kenku-it"] };
    const tiendas = tiendasDe(yo);
    expect(tiendas.map((t) => t.code)).toEqual(["kenku-it"]);
    expect(tiendaActual(tiendas, "/admin/finance", "mireva-cr")?.code).toBe("kenku-it");
  });
});
