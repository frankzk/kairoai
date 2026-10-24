// Que puede hacer cada persona: permisos, roles y que exige cada ruta.
//
// Modulo PURO (sin base, sin Node, sin navegador): lo usan el middleware (edge),
// las rutas del servidor y las pantallas. Se prueba en tests/permisos.test.ts,
// que ademas obliga a que toda ruta de app/api tenga una regla aca.
//
// EL MODELO
//  - Un PERMISO es una pantalla o un poder ("leads", "finanzas", "usuarios").
//    Es lo unico que se aplica: middleware y rutas miran permisos, nunca roles.
//  - Un ROL es una plantilla de permisos ("Asesora" = leads). Una persona puede
//    tener varios roles y los permisos se SUMAN. Despues se pueden ajustar a
//    mano por persona: lo que se guarda y se aplica es la lista final.
//  - Las TIENDAS (Costa Rica / Honduras) van aparte: cada persona trabaja solo
//    sobre las tiendas que tenga marcadas.

export const PERMISOS = [
  "panel",
  "leads",
  "leads_equipo",
  "novedades",
  "pedidos",
  "finanzas",
  "upsell",
  "config",
  "usuarios",
] as const;
export type Permiso = (typeof PERMISOS)[number];

export const PERMISO_INFO: Record<Permiso, { label: string; detalle: string }> = {
  panel: { label: "Panel principal", detalle: "Inicio: llamadas del agente de voz, pedidos y carritos de Shopify" },
  leads: { label: "Leads", detalle: "Tablero de leads, chat y gestiones, siempre a su propio nombre" },
  leads_equipo: {
    label: "Leads: supervisión",
    detalle: "Gestiona como cualquier asesora y ve la productividad de todo el equipo",
  },
  novedades: { label: "Novedades", detalle: "Bandeja de entregas con problemas" },
  pedidos: { label: "Gestión de pedidos", detalle: "Pedidos, despacho, auditoría, notas y archivos de logística" },
  finanzas: { label: "Finanzas", detalle: "Liquidaciones, gastos, cierre mensual, productos y costos" },
  upsell: { label: "Upsells", detalle: "Reglas de venta adicional" },
  config: { label: "Configuración", detalle: "Agente de voz, telefonía y conexiones" },
  usuarios: { label: "Usuarios", detalle: "Crear usuarios y darles accesos" },
};

export const ROLES = ["admin", "jefa_tienda", "asesora", "logistica", "finanzas"] as const;
export type Rol = (typeof ROLES)[number];

export const ROL_INFO: Record<Rol, { label: string; permisos: Permiso[] }> = {
  admin: { label: "Administrador", permisos: [...PERMISOS] },
  jefa_tienda: {
    label: "Jefa de tienda",
    permisos: ["panel", "leads", "leads_equipo", "novedades", "pedidos"],
  },
  asesora: { label: "Asesora", permisos: ["leads"] },
  logistica: { label: "Logística", permisos: ["novedades", "pedidos"] },
  finanzas: { label: "Finanzas", permisos: ["pedidos", "finanzas"] },
};

export function esPermiso(v: unknown): v is Permiso {
  return typeof v === "string" && (PERMISOS as readonly string[]).includes(v);
}

export function esRol(v: unknown): v is Rol {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Permisos que dan varios roles juntos (se suman), en el orden del catalogo. */
export function permisosDeRoles(roles: readonly string[]): Permiso[] {
  const set = new Set<Permiso>();
  for (const r of roles) if (esRol(r)) for (const p of ROL_INFO[r].permisos) set.add(p);
  return PERMISOS.filter((p) => set.has(p));
}

/** Limpia una lista que viene de afuera: solo permisos validos, sin repetir. */
export function normalizarPermisos(lista: unknown): Permiso[] {
  if (!Array.isArray(lista)) return [];
  const set = new Set(lista.filter(esPermiso));
  return PERMISOS.filter((p) => set.has(p));
}

// ─── Que exige cada ruta ─────────────────────────────────────────────────────

/**
 * - publico: no pide sesion (login, webhooks que se autentican solos).
 * - cron: la puerta propia de los crons (sesion o CRON_SECRET).
 * - sesion: cualquiera con sesion valida.
 * - permiso: sesion + al menos UNO de los permisos de la lista.
 */
export type Exigencia =
  | { tipo: "publico" }
  | { tipo: "cron" }
  | { tipo: "sesion" }
  | { tipo: "permiso"; alguno: Permiso[] };

const PUB: Exigencia = { tipo: "publico" };
const SES: Exigencia = { tipo: "sesion" };
const P = (...alguno: Permiso[]): Exigencia => ({ tipo: "permiso", alguno });

// Quienes usan el chat de WhatsApp: el tablero de leads, y el panel de chat
// que tambien aparece dentro de Novedades y del detalle de un pedido.
const CHAT: Permiso[] = ["leads", "leads_equipo", "novedades", "pedidos"];
const LEADS: Permiso[] = ["leads", "leads_equipo"];
const OPERACION: Permiso[] = ["pedidos", "finanzas"];

export type Regla = { ruta: string; metodo?: string; exige: Exigencia };

/**
 * Reglas por PREFIJO de ruta; gana la mas especifica (la mas larga) y, a igual
 * largo, la que nombra el metodo. Las rutas con [param] se escriben con "*"
 * en ese segmento. Lo que no tiene regla queda CERRADO (solo admin), y un test
 * obliga a escribir la regla de cada ruta nueva.
 */
export const REGLAS: Regla[] = [
  // Paginas
  { ruta: "/login", exige: PUB },
  { ruta: "/", exige: P("panel") },
  { ruta: "/cuenta", exige: SES },
  { ruta: "/admin/leads", exige: P(...LEADS) },
  { ruta: "/admin/incidencias", exige: P("novedades") },
  { ruta: "/admin/finance", exige: P(...OPERACION) },
  { ruta: "/admin/settings", exige: P("config") },
  { ruta: "/admin/upsell", exige: P("upsell") },
  { ruta: "/admin/usuarios", exige: P("usuarios") },

  // Sesion y usuarios
  { ruta: "/api/auth/login", exige: PUB },
  { ruta: "/api/auth/logout", exige: PUB },
  { ruta: "/api/auth/me", exige: SES },
  { ruta: "/api/auth/password", exige: SES },
  { ruta: "/api/users", exige: P("usuarios") },
  { ruta: "/api/health/crons", exige: SES },

  // Webhooks externos: se autentican con su propia firma
  { ruta: "/api/shopify/webhook", exige: PUB },
  { ruta: "/api/retell/llm", exige: PUB },
  { ruta: "/api/retell/webhook", exige: PUB },
  { ruta: "/api/zadarma/webhook", exige: PUB },
  // OAuth de Shopify: vuelve desde Shopify sin nuestra cookie de primera parte
  { ruta: "/api/shopify/auth", exige: PUB },

  { ruta: "/api/cron/", exige: { tipo: "cron" } },

  // Panel principal y configuracion
  { ruta: "/api/dashboard", exige: P("panel") },
  { ruta: "/api/calls/trigger", exige: P("panel") },
  { ruta: "/api/agent-settings", exige: P("config") },
  { ruta: "/api/upsell-rules", exige: P("upsell") },
  { ruta: "/api/platform", exige: P("config", "usuarios") },

  // Leads y chat
  { ruta: "/api/leads", exige: P(...CHAT) },
  { ruta: "/api/leads/chat-snapshots", exige: P("leads_equipo", "usuarios") },
  { ruta: "/api/leads/productivity", exige: P(...LEADS) },
  { ruta: "/api/leads/*/disposition", exige: P(...LEADS) },
  { ruta: "/api/leads/*/order", exige: P(...LEADS) },
  { ruta: "/api/leads/*/customer", exige: P(...LEADS) },
  { ruta: "/api/leads/*/carts", exige: P(...LEADS) },
  { ruta: "/api/leads/*/orders", exige: P(...LEADS) },
  { ruta: "/api/leads/*/history", exige: P(...LEADS) },
  { ruta: "/api/quick-replies", exige: P(...CHAT) },

  // Novedades
  { ruta: "/api/incidents", exige: P("novedades") },

  // Gestion de pedidos / finanzas
  { ruta: "/api/finance", exige: P("finanzas") },
  { ruta: "/api/finance/orders", exige: P(...OPERACION) },
  { ruta: "/api/finance/order-detail", exige: P(...OPERACION) },
  { ruta: "/api/finance/kpis", exige: P(...OPERACION) },
  { ruta: "/api/finance/dispatch-audit", exige: P(...OPERACION) },
  { ruta: "/api/finance/productividad", exige: P(...OPERACION) },
  { ruta: "/api/finance/notes", exige: P(...OPERACION) },
  { ruta: "/api/finance/boxful-files", exige: P(...OPERACION) },
  { ruta: "/api/finance/logistics", exige: P(...OPERACION) },
  { ruta: "/api/finance/shopify-sync", exige: P(...OPERACION) },
  { ruta: "/api/finance/moovin-sync", exige: P(...OPERACION) },
  { ruta: "/api/finance/forza-sync", exige: P(...OPERACION) },
  { ruta: "/api/finance/moovin-tracking", exige: P(...OPERACION) },
  { ruta: "/api/finance/forza-tracking", exige: P(...OPERACION) },
  { ruta: "/api/finance/wyn-tracking", exige: P(...OPERACION) },
  // La lista de asesoras la necesitan el chat y el detalle de pedido;
  // modificarla es de quien administra personal.
  { ruta: "/api/finance/payroll-staff", metodo: "GET", exige: SES },
  { ruta: "/api/finance/payroll-staff", exige: P("finanzas", "usuarios") },
  { ruta: "/api/icomfly", exige: P(...OPERACION) },

  // Shopify
  { ruta: "/api/shopify", exige: P("config") },
  { ruta: "/api/shopify/orders", exige: P("panel", ...OPERACION) },
  { ruta: "/api/shopify/note-orders", exige: P(...OPERACION) },
  { ruta: "/api/shopify/draft-orders", exige: P("panel", ...LEADS) },
  { ruta: "/api/shopify/checkouts", exige: P("panel", "config") },
  { ruta: "/api/shopify/products", exige: P(...LEADS, ...OPERACION, "upsell") },

  // Telefonia
  { ruta: "/api/zadarma", exige: P("config") },
  { ruta: "/api/zadarma/call", exige: P(...LEADS, "pedidos") },
  { ruta: "/api/zadarma/webphone", exige: P(...LEADS, ...OPERACION) },
  { ruta: "/api/zadarma/last-call", exige: P(...LEADS, ...OPERACION) },
  { ruta: "/api/zadarma/extensions", exige: P("finanzas", "usuarios", "config") },
];

/** Exigencia para lo que no tiene regla: solo quien administra usuarios. */
export const SIN_REGLA: Exigencia = P("usuarios");

/** Archivos estaticos y assets de Next: nunca pasan por los permisos. */
export function esEstatico(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname.startsWith("/favicon") || /\.[a-z0-9]+$/i.test(pathname);
}

function coincide(regla: string, pathname: string): boolean {
  if (regla === "/") return pathname === "/";
  const r = regla.split("/");
  const p = pathname.split("/");
  const prefijoDeCarpeta = regla.endsWith("/");
  if (prefijoDeCarpeta) r.pop();
  if (p.length < r.length) return false;
  for (let i = 0; i < r.length; i++) {
    if (r[i] === "*") {
      if (!p[i]) return false;
      continue;
    }
    if (r[i] !== p[i]) return false;
  }
  return true;
}

/** La regla que aplica a `pathname` con `metodo`, o null si no hay ninguna. */
export function reglaDe(pathname: string, metodo = "GET"): Regla | null {
  const m = metodo.toUpperCase();
  let mejor: Regla | null = null;
  let mejorPeso = -1;
  for (const regla of REGLAS) {
    if (regla.metodo && regla.metodo !== m) continue;
    if (!coincide(regla.ruta, pathname)) continue;
    const peso = regla.ruta.length * 2 + (regla.metodo ? 1 : 0);
    if (peso > mejorPeso) {
      mejor = regla;
      mejorPeso = peso;
    }
  }
  return mejor;
}

/** Que exige `pathname` con `metodo`. Ver REGLAS. */
export function exigenciaDe(pathname: string, metodo = "GET"): Exigencia {
  return reglaDe(pathname, metodo)?.exige ?? SIN_REGLA;
}

/** true si alguien con `permisos` cumple la exigencia (sin mirar la sesion). */
export function cumple(exige: Exigencia, permisos: readonly Permiso[]): boolean {
  if (exige.tipo !== "permiso") return true;
  return exige.alguno.some((p) => permisos.includes(p));
}

/** Pantallas, en el orden en que se ofrecen como inicio. */
export const PANTALLAS: Array<{ ruta: string; label: string; exige: Permiso[] }> = [
  { ruta: "/admin/leads", label: "Leads", exige: LEADS },
  { ruta: "/admin/incidencias", label: "Novedades", exige: ["novedades"] },
  { ruta: "/admin/finance", label: "Gestión", exige: OPERACION },
  { ruta: "/", label: "Panel", exige: ["panel"] },
  { ruta: "/admin/upsell", label: "Upsells", exige: ["upsell"] },
  { ruta: "/admin/settings", label: "Configuración", exige: ["config"] },
  { ruta: "/admin/usuarios", label: "Usuarios", exige: ["usuarios"] },
];

/** Pantallas que puede abrir alguien con `permisos`. */
export function pantallasDe(permisos: readonly Permiso[]): typeof PANTALLAS {
  return PANTALLAS.filter((s) => s.exige.some((p) => permisos.includes(p)));
}

/** A donde va despues de entrar: la primera pantalla que puede ver. */
export function inicioDe(permisos: readonly Permiso[]): string {
  return pantallasDe(permisos)[0]?.ruta ?? "/cuenta";
}

/** true si `next` es una ruta interna segura para redirigir (no otro sitio). */
export function rutaInternaSegura(next: unknown): next is string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\");
}
