// Menú lateral de Kairo: qué secciones ve cada persona y en qué grupo van.
//
// Sale de los mismos permisos que deciden las rutas (lib/permisos.ts), así una
// asesora nueva no ve secciones que la mandan a pantallas que no son suyas.
// Los grupos ordenan el menú por trabajo, no por permiso: primero la operación
// del día, después crecer, después las tiendas Kenku y al final los ajustes.

import { pantallasDe, type Permiso } from "./permisos";
import { KENKU_MANAGEMENT_STORES } from "./kenku-management";

export type IconoNav =
  | "panel"
  | "leads"
  | "novedades"
  | "gestion"
  | "marketing"
  | "upsell"
  | "config"
  | "usuarios"
  | "tienda";

export interface ItemNav {
  ruta: string;
  label: string;
  icono: IconoNav;
  /** Activa solo con la ruta exacta (Panel es "/", prefijo de todo). */
  exacta?: boolean;
}

export interface GrupoNav {
  key: "operacion" | "crecimiento" | "tiendas" | "ajustes";
  label: string;
  items: ItemNav[];
}

const GRUPO: Record<string, { grupo: GrupoNav["key"]; icono: IconoNav }> = {
  "/": { grupo: "operacion", icono: "panel" },
  "/admin/leads": { grupo: "operacion", icono: "leads" },
  "/admin/incidencias": { grupo: "operacion", icono: "novedades" },
  "/admin/finance": { grupo: "operacion", icono: "gestion" },
  "/admin/marketing": { grupo: "crecimiento", icono: "marketing" },
  "/admin/upsell": { grupo: "crecimiento", icono: "upsell" },
  "/admin/settings": { grupo: "ajustes", icono: "config" },
  "/admin/usuarios": { grupo: "ajustes", icono: "usuarios" },
};

const GRUPOS: Array<Pick<GrupoNav, "key" | "label">> = [
  { key: "operacion", label: "Operación" },
  { key: "crecimiento", label: "Crecimiento" },
  { key: "tiendas", label: "Tiendas Kenku" },
  { key: "ajustes", label: "Ajustes" },
];

/** Orden dentro de Operación: el inicio general primero. */
const ORDEN = ["/", "/admin/leads", "/admin/incidencias", "/admin/finance"];

export function menuDe(yo: {
  id: number;
  permisos: readonly Permiso[];
  tiendas: readonly string[];
}): GrupoNav[] {
  const pantallas = pantallasDe(yo.permisos).filter(
    // Marketing es de Mireva Costa Rica: sin esa tienda no hay nada que ver.
    (p) => p.ruta !== "/admin/marketing" || yo.tiendas.includes("mireva-cr"),
  );
  const items = new Map<GrupoNav["key"], ItemNav[]>();
  for (const p of pantallas) {
    const meta = GRUPO[p.ruta];
    if (!meta) continue;
    const lista = items.get(meta.grupo) ?? [];
    lista.push({
      ruta: p.ruta,
      label: p.ruta === "/admin/finance" ? "Gestión de pedidos" : p.label,
      icono: meta.icono,
      exacta: p.ruta === "/" || undefined,
    });
    items.set(meta.grupo, lista);
  }
  items
    .get("operacion")
    ?.sort((a, b) => ORDEN.indexOf(a.ruta) - ORDEN.indexOf(b.ruta));
  const kenku = KENKU_MANAGEMENT_STORES.filter(
    (s) =>
      (yo.id === 0 || yo.tiendas.includes(s.code)) &&
      yo.permisos.some((p) => p === "pedidos" || p === "finanzas"),
  ).map<ItemNav>((s) => ({ ruta: s.path, label: s.region, icono: "tienda" }));
  if (kenku.length) items.set("tiendas", kenku);
  return GRUPOS.filter((g) => items.get(g.key)?.length).map((g) => ({
    ...g,
    items: items.get(g.key)!,
  }));
}

/**
 * El ítem activo es el de la ruta más larga que coincide: en
 * /admin/finance/italia gana "Italia", no "Gestión de pedidos".
 */
export function itemActivo(
  grupos: readonly GrupoNav[],
  pathname: string,
): string | null {
  let mejor: string | null = null;
  for (const item of grupos.flatMap((g) => g.items)) {
    const coincide = item.exacta
      ? pathname === item.ruta
      : pathname === item.ruta || pathname.startsWith(`${item.ruta}/`);
    if (coincide && (!mejor || item.ruta.length > mejor.length))
      mejor = item.ruta;
  }
  return mejor;
}
