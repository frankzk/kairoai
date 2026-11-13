// Menú lateral de Kairo: qué tiendas y secciones ve cada persona.
//
// La tienda se elige UNA vez, arriba del menú (como el selector de cuenta de
// Stripe): Mireva Costa Rica / Honduras comparten las mismas pantallas y la
// tienda viaja por useSelectedStore; las tiendas Kenku tienen su propia
// pantalla de pedidos. Las secciones salen de los mismos permisos que
// deciden las rutas (lib/permisos.ts), así una asesora nueva no ve secciones
// que la mandan a pantallas que no son suyas.

import { pantallasDe, type Permiso } from "./permisos";
import { KENKU_MANAGEMENT_STORES } from "./kenku-management";
import { FINANCE_STORES } from "./store-config";

export type IconoNav =
  | "panel"
  | "leads"
  | "novedades"
  | "gestion"
  | "marketing"
  | "upsell"
  | "config"
  | "usuarios";

export interface ItemNav {
  ruta: string;
  label: string;
  icono: IconoNav;
  /** Activa solo con la ruta exacta (Panel es "/", prefijo de todo). */
  exacta?: boolean;
}

export interface GrupoNav {
  key: "operacion" | "crecimiento" | "ajustes";
  label: string;
  items: ItemNav[];
}

export interface TiendaNav {
  code: string;
  /** "Mireva Costa Rica", "Kenku Italia". */
  label: string;
  /** Marca y país para la segunda línea: "Mireva · Costa Rica". */
  marca: "Mireva" | "Kenku";
  pais: string;
  /** Kenku: su pantalla propia. Mireva: null (se elige y se queda en la pantalla). */
  ruta: string | null;
}

interface Persona {
  id: number;
  permisos: readonly Permiso[];
  tiendas: readonly string[];
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
  { key: "ajustes", label: "Ajustes" },
];

/** Orden dentro de Operación: el resumen primero. */
const ORDEN = ["/", "/admin/leads", "/admin/incidencias", "/admin/finance"];

/** Marketing es solo de Mireva Costa Rica. */
export const TIENDA_MARKETING = "mireva-cr";

/**
 * Tiendas que la persona puede elegir, en el orden del selector: primero las
 * Mireva (mismas reglas que useSelectedStore: las suyas, o todas si la sesión
 * no trae ninguna), después las Kenku (con pedidos o finanzas y la tienda).
 */
export function tiendasDe(yo: Persona): TiendaNav[] {
  const propias = FINANCE_STORES.filter((s) => yo.tiendas.includes(s.code));
  const soloKenku =
    yo.id !== 0 &&
    !propias.length &&
    KENKU_MANAGEMENT_STORES.some((s) => yo.tiendas.includes(s.code));
  const mireva = (
    propias.length ? propias : soloKenku ? [] : FINANCE_STORES
  ).map<TiendaNav>(
    (s) => ({
      code: s.code,
      label: s.label,
      marca: "Mireva",
      pais: s.shortLabel,
      ruta: null,
    }),
  );
  const kenku = KENKU_MANAGEMENT_STORES.filter(
    (s) =>
      (yo.id === 0 || yo.tiendas.includes(s.code)) &&
      yo.permisos.some((p) => p === "pedidos" || p === "finanzas"),
  ).map<TiendaNav>((s) => ({
    code: s.code,
    label: s.label,
    marca: "Kenku",
    pais: s.region,
    ruta: s.path,
  }));
  return [...mireva, ...kenku];
}

/**
 * La tienda que se está viendo: una Kenku si la ruta es su pantalla; en
 * Marketing, Mireva Costa Rica; si no, la elegida (useSelectedStore).
 */
export function tiendaActual(
  tiendas: readonly TiendaNav[],
  pathname: string,
  elegida: string,
): TiendaNav | null {
  const kenku = tiendas.find(
    (t) =>
      t.ruta && (pathname === t.ruta || pathname.startsWith(`${t.ruta}/`)),
  );
  if (kenku) return kenku;
  const code = pathname.startsWith("/admin/marketing")
    ? TIENDA_MARKETING
    : elegida;
  return (
    tiendas.find((t) => t.code === code) ??
    tiendas.find((t) => t.marca === "Mireva") ??
    tiendas[0] ??
    null
  );
}

/** Secciones del menú para la tienda que se está viendo. */
export function menuDe(yo: Persona, tienda: TiendaNav | null = null): GrupoNav[] {
  const pantallas = pantallasDe(yo.permisos);
  const items = new Map<GrupoNav["key"], ItemNav[]>();
  const add = (grupo: GrupoNav["key"], item: ItemNav) =>
    items.set(grupo, [...(items.get(grupo) ?? []), item]);

  if (tienda?.marca === "Kenku" && tienda.ruta) {
    // Tienda Kenku: su pantalla de pedidos (con sus pestañas adentro); las
    // pantallas de Mireva no aplican. Ajustes sigue igual.
    add("operacion", { ruta: tienda.ruta, label: "Pedidos", icono: "gestion" });
  } else {
    for (const p of pantallas) {
      const meta = GRUPO[p.ruta];
      if (!meta || meta.grupo === "ajustes") continue;
      if (
        p.ruta === "/admin/marketing" &&
        (!yo.tiendas.includes(TIENDA_MARKETING) ||
          (tienda && tienda.code !== TIENDA_MARKETING))
      )
        continue;
      add(meta.grupo, {
        ruta: p.ruta,
        label: p.ruta === "/admin/finance" ? "Gestión de pedidos" : p.label,
        icono: meta.icono,
        exacta: p.ruta === "/" || undefined,
      });
    }
    items
      .get("operacion")
      ?.sort((a, b) => ORDEN.indexOf(a.ruta) - ORDEN.indexOf(b.ruta));
  }
  for (const p of pantallas) {
    const meta = GRUPO[p.ruta];
    if (meta?.grupo === "ajustes")
      add("ajustes", { ruta: p.ruta, label: p.label, icono: meta.icono });
  }
  return GRUPOS.filter((g) => items.get(g.key)?.length).map((g) => ({
    ...g,
    items: items.get(g.key)!,
  }));
}

/**
 * El ítem activo es el de la ruta más larga que coincide: en
 * /admin/finance/italia/costos gana "Pedidos" de Italia, no Gestión.
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
