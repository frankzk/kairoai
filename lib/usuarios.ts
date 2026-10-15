// Usuarios de Kairo: contraseñas, ingreso y administracion.
//
// Corre en Node (rutas del servidor). La parte pura —validaciones y armado de
// la sesion— esta separada para probarla sin base (tests/usuarios.test.ts).

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getDB } from "./db";
import { SESSION_MAX_AGE_S, type SesionClaims } from "./auth";
import { normalizarPermisos, esRol, type Permiso, type Rol } from "./permisos";
import { FINANCE_STORES } from "./store-config";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

// ─── Contraseñas ─────────────────────────────────────────────────────────────

const N = 16384;
const R = 8;
const PAR = 1;
const LARGO = 32;

export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(clave, sal, LARGO, { N, r: R, p: PAR });
  return `scrypt$${N}$${R}$${PAR}$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, n, r, p, salB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, "base64");
  const calculado = await scrypt(clave, Buffer.from(salB64, "base64"), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/** null si la contraseña sirve; si no, por que no. */
export function problemaDeClave(clave: string, username = ""): string | null {
  if (clave.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (clave.length > 128) return "La contraseña es demasiado larga.";
  if (username && clave.toLowerCase().includes(username.toLowerCase())) {
    return "La contraseña no puede contener el usuario.";
  }
  if (/^(.)\1+$/.test(clave) || /^(12345678|password|contraseña|mireva)/i.test(clave)) {
    return "Esa contraseña es demasiado fácil de adivinar.";
  }
  return null;
}

/** Usuarios en minuscula, sin espacios. "admin" queda reservado. */
export function normalizarUsuario(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function problemaDeUsuario(username: string): string | null {
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return "El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo, sin espacios.";
  }
  if (username === "admin") return "El usuario \"admin\" está reservado.";
  return null;
}

/** Correo para entrar (opcional): en minuscula, sin espacios. Vacio = null. */
export function normalizarEmail(v: unknown): string | null {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return e || null;
}

export function problemaDeEmail(email: string | null): string | null {
  if (email === null) return null;
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "El correo no es válido.";
  return null;
}

/**
 * Lo que se guarda como hash de quien todavia no tiene contraseña (cuenta
 * creada sin clave: se la pone el dueño desde Usuarios). No es un hash scrypt,
 * asi que ninguna contraseña coincide.
 */
export const SIN_CLAVE = "pendiente";

export function tieneClave(passwordHash: string): boolean {
  return passwordHash.startsWith("scrypt$");
}

export const CODIGOS_TIENDA = FINANCE_STORES.map((s) => s.code) as string[];

export function normalizarTiendas(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.filter((x): x is string => typeof x === "string"));
  return CODIGOS_TIENDA.filter((c) => set.has(c));
}

export function normalizarRoles(v: unknown): Rol[] {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.filter(esRol)));
}

// ─── Bloqueo por intentos ────────────────────────────────────────────────────

export const MAX_INTENTOS = 5;
export const BLOQUEO_MIN = 15;

/** Tras un intento fallido: cuantos lleva y si queda bloqueado (y hasta cuando). */
export function trasFallo(intentos: number, ahora: Date): { intentos: number; bloqueadoHasta: string | null } {
  const n = intentos + 1;
  if (n >= MAX_INTENTOS) {
    return { intentos: 0, bloqueadoHasta: new Date(ahora.getTime() + BLOQUEO_MIN * 60_000).toISOString() };
  }
  return { intentos: n, bloqueadoHasta: null };
}

// ─── Filas ───────────────────────────────────────────────────────────────────

export interface UsuarioFila {
  id: number;
  username: string;
  email: string | null;
  nombre: string;
  password_hash: string;
  roles: string[];
  permisos: string[];
  tiendas: string[];
  staff_id: number | null;
  activo: boolean;
  debe_cambiar_clave: boolean;
  session_version: number;
  intentos_fallidos: number;
  bloqueado_hasta: string | null;
  ultimo_ingreso: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo que se muestra en la pantalla de usuarios: nunca el hash. */
export type UsuarioPublico = Omit<UsuarioFila, "password_hash" | "intentos_fallidos" | "session_version"> & {
  /** Todavia no tiene contraseña: el dueño se la pone desde Usuarios. */
  sin_clave: boolean;
};

export function aPublico(u: UsuarioFila): UsuarioPublico {
  const resto: Partial<UsuarioFila> = { ...u };
  delete resto.password_hash;
  delete resto.intentos_fallidos;
  delete resto.session_version;
  return { ...(resto as Omit<UsuarioPublico, "sin_clave">), sin_clave: !tieneClave(u.password_hash) };
}

/** La sesion de una persona a partir de su fila. Solo lo que existe hoy. */
export function claimsDeUsuario(u: UsuarioFila, nowS = Math.floor(Date.now() / 1000)): SesionClaims {
  return {
    u: u.id,
    n: u.nombre,
    p: normalizarPermisos(u.permisos) as Permiso[],
    s: normalizarTiendas(u.tiendas),
    st: u.staff_id,
    sv: u.session_version,
    mc: u.debe_cambiar_clave,
    exp: nowS + SESSION_MAX_AGE_S,
  };
}

const TABLA = "kairo_users";

/** Por usuario o, si trae "@", por correo (ya normalizado en minuscula). */
export async function buscarPorUsuario(identificador: string): Promise<UsuarioFila | null> {
  const columna = identificador.includes("@") ? "email" : "username";
  const { data, error } = await getDB().from(TABLA).select("*").eq(columna, identificador).maybeSingle();
  if (error) throw new Error(`buscarPorUsuario: ${error.message}`);
  return (data as UsuarioFila | null) ?? null;
}

export async function buscarPorId(id: number): Promise<UsuarioFila | null> {
  const { data, error } = await getDB().from(TABLA).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`buscarPorId: ${error.message}`);
  return (data as UsuarioFila | null) ?? null;
}

export async function listarUsuarios(): Promise<UsuarioFila[]> {
  const { data, error } = await getDB().from(TABLA).select("*").order("activo", { ascending: false }).order("nombre");
  if (error) throw new Error(`listarUsuarios: ${error.message}`);
  return (data ?? []) as UsuarioFila[];
}

export async function actualizarUsuario(id: number, patch: Partial<UsuarioFila>): Promise<UsuarioFila> {
  const { data, error } = await getDB()
    .from(TABLA)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as UsuarioFila;
}

export async function crearUsuario(fila: Omit<UsuarioFila, "id" | "created_at" | "updated_at" | "intentos_fallidos" | "bloqueado_hasta" | "ultimo_ingreso" | "session_version"> & { creado_por: string }): Promise<UsuarioFila> {
  const { data, error } = await getDB().from(TABLA).insert(fila).select("*").single();
  if (error) throw new Error(error.message);
  return data as UsuarioFila;
}

export async function registrarEvento(
  userId: number | null,
  actor: string,
  accion: string,
  detalle: Record<string, unknown> = {}
): Promise<void> {
  // La bitacora nunca rompe la operacion que registra.
  try {
    await getDB().from("kairo_user_events").insert({ user_id: userId, actor, accion, detalle });
  } catch {
    /* best-effort */
  }
}

// ─── Ingreso ─────────────────────────────────────────────────────────────────

export type ResultadoIngreso =
  | { ok: true; usuario: UsuarioFila }
  | { ok: false; motivo: "credenciales" | "bloqueado" | "inactivo"; hasta?: string };

/**
 * Valida usuario (o correo) y contraseña. Mismo mensaje para usuario inexistente y clave
 * incorrecta, para no revelar que usuarios existen. 5 fallos seguidos bloquean
 * 15 minutos.
 */
export async function ingresar(usernameRaw: string, clave: string, ahora = new Date()): Promise<ResultadoIngreso> {
  const username = normalizarUsuario(usernameRaw);
  const u = username ? await buscarPorUsuario(username) : null;
  if (!u) {
    // Mismo costo que una verificacion real: no se distingue por tiempo.
    await verificarClave(clave, `scrypt$${N}$${R}$${PAR}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(LARGO).toString("base64")}`);
    return { ok: false, motivo: "credenciales" };
  }
  if (u.bloqueado_hasta && Date.parse(u.bloqueado_hasta) > ahora.getTime()) {
    return { ok: false, motivo: "bloqueado", hasta: u.bloqueado_hasta };
  }
  const bien = await verificarClave(clave, u.password_hash);
  if (!bien) {
    const t = trasFallo(u.intentos_fallidos, ahora);
    await actualizarUsuario(u.id, { intentos_fallidos: t.intentos, bloqueado_hasta: t.bloqueadoHasta });
    if (t.bloqueadoHasta) await registrarEvento(u.id, u.username, "bloqueado", { hasta: t.bloqueadoHasta });
    return t.bloqueadoHasta ? { ok: false, motivo: "bloqueado", hasta: t.bloqueadoHasta } : { ok: false, motivo: "credenciales" };
  }
  if (!u.activo) return { ok: false, motivo: "inactivo" };
  const actualizado = await actualizarUsuario(u.id, {
    intentos_fallidos: 0,
    bloqueado_hasta: null,
    ultimo_ingreso: ahora.toISOString(),
  });
  await registrarEvento(u.id, u.username, "ingreso");
  return { ok: true, usuario: actualizado };
}
