// Revalidacion de la sesion contra la base, para el middleware (edge).
//
// La cookie firmada dice quien es la persona, pero lo que PUEDE hacer se lee
// de la base: si la desactivan, le cambian permisos o tiendas, o le resetean la
// contraseña, tiene que notarse ya, no cuando venza la cookie. Se consulta como
// mucho una vez cada CACHE_MS por persona (cache del proceso).
//
// Si la base no responde, se sigue con lo que dice la cookie firmada: una caida
// de Supabase no puede dejar a todo el equipo afuera.

import type { SesionClaims } from "./auth";
import { normalizarPermisos } from "./permisos";

export interface EstadoUsuario {
  activo: boolean;
  sv: number;
  nombre: string;
  permisos: string[];
  tiendas: string[];
  staffId: number | null;
  debeCambiar: boolean;
}

/** "sin_datos" = no se pudo consultar (se usa la cookie); null = no existe. */
export type Consulta = EstadoUsuario | null | "sin_datos";

export const CACHE_MS = 30_000;
const TIMEOUT_MS = 2_500;

const cache = new Map<number, { at: number; estado: EstadoUsuario | null }>();

/** Para los tests. */
export function limpiarCache(): void {
  cache.clear();
}

/**
 * Aplica el estado de la base sobre la cookie. Devuelve los claims vigentes o
 * null si la sesion ya no vale (no existe, desactivada, o version vieja).
 */
export function aplicarEstado(claims: SesionClaims, estado: Consulta): SesionClaims | null {
  if (estado === "sin_datos") return claims;
  if (!estado || !estado.activo || estado.sv !== claims.sv) return null;
  return {
    ...claims,
    n: estado.nombre || claims.n,
    p: normalizarPermisos(estado.permisos),
    s: estado.tiendas,
    st: estado.staffId,
    mc: estado.debeCambiar,
  };
}

/**
 * Estado de la persona en la base, con cache de CACHE_MS.
 *
 * `versionCookie`: si la cookie trae una version de sesion MAS NUEVA que la
 * guardada en cache, la cache esta vieja (la persona acaba de cambiar su
 * contraseña y recibio una cookie nueva) y se consulta de nuevo. Sin esto, el
 * cambio de contraseña la dejaba afuera hasta 30 s.
 */
export async function consultarEstado(
  userId: number,
  nowMs: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
  versionCookie?: number
): Promise<Consulta> {
  const hit = cache.get(userId);
  const cacheVieja = hit?.estado && versionCookie !== undefined && versionCookie > hit.estado.sv;
  if (hit && nowMs - hit.at < CACHE_MS && !cacheVieja) return hit.estado;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return "sin_datos";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(
      `${url}/rest/v1/kairo_users?id=eq.${userId}&select=activo,session_version,nombre,permisos,tiendas,staff_id,debe_cambiar_clave`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: controller.signal,
      }
    );
    if (!res.ok) return "sin_datos";
    const filas = (await res.json()) as Array<{
      activo: boolean;
      session_version: number;
      nombre: string;
      permisos: string[] | null;
      tiendas: string[] | null;
      staff_id: number | null;
      debe_cambiar_clave: boolean;
    }>;
    const f = filas[0];
    const estado: EstadoUsuario | null = f
      ? {
          activo: f.activo,
          sv: f.session_version,
          nombre: f.nombre,
          permisos: f.permisos ?? [],
          tiendas: f.tiendas ?? [],
          staffId: f.staff_id,
          debeCambiar: f.debe_cambiar_clave,
        }
      : null;
    cache.set(userId, { at: nowMs, estado });
    return estado;
  } catch {
    return "sin_datos";
  } finally {
    clearTimeout(timer);
  }
}
