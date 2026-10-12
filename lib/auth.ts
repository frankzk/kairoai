// Sesion firmada de cada persona.
//
// La cookie lleva QUIEN es (id de usuario, nombre, permisos, tiendas, asesora
// vinculada, version de sesion y vencimiento) firmado con HMAC-SHA256. Nadie
// puede cambiar sus permisos editando la cookie: la firma deja de coincidir.
//
// Solo usa Web Crypto, asi corre en el middleware (edge) y en Node.
//
// ANTES (hasta el 12/10/2026) la cookie era una firma fija ("kairo-admin") que
// compartia todo el equipo: no habia usuarios ni niveles. Esas cookies viejas
// ya no validan; todos vuelven a entrar una vez.

import { normalizarPermisos, PERMISOS, type Permiso } from "./permisos";

export const SESSION_COOKIE = "kairo_session";
/** Cuanto dura una sesion. Despues hay que volver a entrar. */
export const SESSION_MAX_AGE_S = 60 * 60 * 12;
const PREFIJO = "v2";

/** El admin de la contraseña compartida no tiene fila en la tabla de usuarios. */
export const ADMIN_LEGADO_ID = 0;

export interface SesionClaims {
  /** id en kairo_users; 0 = admin de la contraseña compartida. */
  u: number;
  /** Nombre para mostrar. */
  n: string;
  /** Permisos al momento de entrar (el middleware los refresca desde la base). */
  p: Permiso[];
  /** Codigos de tienda permitidos ("mireva-cr", "mireva-hn"). */
  s: string[];
  /** id en payroll_staff si es asesora, o null. */
  st: number | null;
  /** Version de sesion: si cambia en la base, la sesion deja de valer. */
  sv: number;
  /** Debe cambiar la contraseña antes de seguir. */
  mc: boolean;
  /** Vencimiento, epoch en segundos. */
  exp: number;
}

function getAuthSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.APP_SECRET ?? "";
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return b64urlEncode(new Uint8Array(sig));
}

/** Compara sin cortar en el primer caracter distinto (no filtra por tiempos). */
function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function firmarSesion(claims: SesionClaims): Promise<string> {
  const secret = getAuthSecret();
  if (!secret) throw new Error("Falta AUTH_SECRET o APP_SECRET");
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const cuerpo = `${PREFIJO}.${payload}`;
  return `${cuerpo}.${await hmac(cuerpo, secret)}`;
}

/** Devuelve los claims si la cookie es valida y no vencio; si no, null. */
export async function leerSesion(
  value: string | null | undefined,
  nowS: number = Math.floor(Date.now() / 1000)
): Promise<SesionClaims | null> {
  const secret = getAuthSecret();
  if (!secret || !value) return null;
  const partes = value.split(".");
  if (partes.length !== 3 || partes[0] !== PREFIJO) return null;
  const esperada = await hmac(`${partes[0]}.${partes[1]}`, secret);
  if (!igualSeguro(esperada, partes[2])) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(b64urlDecode(partes[1])));
  } catch {
    return null;
  }
  const c = raw as Partial<SesionClaims>;
  if (typeof c.u !== "number" || typeof c.exp !== "number" || c.exp <= nowS) return null;
  return {
    u: c.u,
    n: typeof c.n === "string" ? c.n : "",
    p: normalizarPermisos(c.p),
    s: Array.isArray(c.s) ? c.s.filter((x): x is string => typeof x === "string") : [],
    st: typeof c.st === "number" ? c.st : null,
    sv: typeof c.sv === "number" ? c.sv : 0,
    mc: c.mc === true,
    exp: c.exp,
  };
}

/** Claims del admin de la contraseña compartida: todo, en todas las tiendas. */
export function claimsAdminLegado(tiendas: string[], nowS = Math.floor(Date.now() / 1000)): SesionClaims {
  return {
    u: ADMIN_LEGADO_ID,
    n: "Administrador",
    p: [...PERMISOS],
    s: tiendas,
    st: null,
    sv: 0,
    mc: false,
    exp: nowS + SESSION_MAX_AGE_S,
  };
}

/** Contraseña compartida de siempre: ahora solo da acceso de administrador. */
export function esClaveAdminLegado(password: string): boolean {
  const configurada = process.env.ADMIN_PASSWORD ?? process.env.APP_SECRET ?? "";
  if (!configurada || !password) return false;
  return igualSeguro(configurada, password);
}

export function opcionesCookie(maxAge = SESSION_MAX_AGE_S) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// ─── Identidad dentro del servidor ───────────────────────────────────────────
// El middleware valida la sesion y deja la identidad YA REVALIDADA en estos
// headers internos (borrando antes cualquiera que haya mandado el navegador).
// Las rutas la leen de aca: no vuelven a tocar la cookie ni la base.

export const HEADER_USUARIO = "x-kairo-usuario";

export interface Identidad {
  id: number;
  nombre: string;
  permisos: Permiso[];
  tiendas: string[];
  staffId: number | null;
}

export function identidadAHeader(c: Pick<SesionClaims, "u" | "n" | "p" | "s" | "st">): string {
  return encodeURIComponent(JSON.stringify({ id: c.u, nombre: c.n, permisos: c.p, tiendas: c.s, staffId: c.st }));
}

export function identidadDeHeader(value: string | null | undefined): Identidad | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(value)) as Partial<Identidad>;
    if (typeof raw.id !== "number") return null;
    return {
      id: raw.id,
      nombre: typeof raw.nombre === "string" ? raw.nombre : "",
      permisos: normalizarPermisos(raw.permisos),
      tiendas: Array.isArray(raw.tiendas) ? raw.tiendas.filter((x): x is string => typeof x === "string") : [],
      staffId: typeof raw.staffId === "number" ? raw.staffId : null,
    };
  } catch {
    return null;
  }
}
