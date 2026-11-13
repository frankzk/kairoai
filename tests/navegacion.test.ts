import { describe, expect, it } from "vitest";
import { itemActivo, menuDe } from "../lib/navegacion";
import { PERMISOS } from "../lib/permisos";

const admin = { id: 0, permisos: [...PERMISOS], tiendas: ["mireva-cr"] };

describe("menuDe", () => {
  it("groups an admin's sections by work, Panel first", () => {
    const grupos = menuDe(admin);
    expect(grupos.map((g) => g.label)).toEqual([
      "Operación",
      "Crecimiento",
      "Tiendas Kenku",
      "Ajustes",
    ]);
    expect(grupos[0].items.map((i) => i.label)).toEqual([
      "Panel",
      "Leads",
      "Novedades",
      "Gestión de pedidos",
    ]);
    expect(grupos[1].items.map((i) => i.label)).toEqual(["Marketing", "Upsells"]);
    expect(grupos[2].items.map((i) => i.label)).toEqual([
      "Italia",
      "México",
      "Argentina",
    ]);
  });

  it("shows an advisor only Leads, with no empty groups", () => {
    const grupos = menuDe({ id: 7, permisos: ["leads"], tiendas: ["mireva-cr"] });
    expect(grupos).toEqual([
      {
        key: "operacion",
        label: "Operación",
        items: [{ ruta: "/admin/leads", label: "Leads", icono: "leads" }],
      },
    ]);
  });

  it("hides Marketing without the Mireva CR store and Kenku stores without access", () => {
    const grupos = menuDe({
      id: 3,
      permisos: ["marketing", "pedidos"],
      tiendas: ["kenku-mx"],
    });
    expect(grupos.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      "Gestión de pedidos",
      "México",
    ]);
  });
});

describe("itemActivo", () => {
  const grupos = menuDe(admin);
  it("picks the longest matching route", () => {
    expect(itemActivo(grupos, "/admin/finance/italia/costos")).toBe(
      "/admin/finance/italia",
    );
    expect(itemActivo(grupos, "/admin/finance")).toBe("/admin/finance");
    expect(itemActivo(grupos, "/admin/marketing")).toBe("/admin/marketing");
  });
  it("keeps Panel exact and ignores look-alike prefixes", () => {
    expect(itemActivo(grupos, "/")).toBe("/");
    expect(itemActivo(grupos, "/cuenta")).toBeNull();
    expect(itemActivo(grupos, "/admin/financeX")).toBeNull();
  });
});
