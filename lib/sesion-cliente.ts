// Quien soy, del lado del navegador.
//
// El middleware deja en cada pagina una cookie LEGIBLE ("kairo_yo") con nombre,
// permisos, tiendas y asesora. Sirve para armar la pantalla (que botones,
// que tiendas, si el selector de asesora va fijo) sin esperar una consulta.
//
// NO es una frontera de seguridad: editarla no da ningun acceso. Lo que se
// puede hacer lo decide el servidor con la sesion firmada (lib/auth.ts).

import type { Permiso } from "./permisos";

export const COOKIE_YO = "kairo_yo";

export interface Yo {
  id: number;
  nombre: string;
  permisos: Permiso[];
  tiendas: string[];
  staffId: number | null;
  /** Tiene que cambiar la contraseña inicial antes de seguir. */
  debeCambiar: boolean;
}

/** Valor para la cookie. Va sin codificar: Next lo codifica al escribirla. */
export function yoACookie(yo: Yo): string {
  return JSON.stringify(yo);
}

export function yoDeCookie(valor: string | undefined | null): Yo | null {
  if (!valor) return null;
  try {
    // Una sola decodificacion: la que deshace la de Next al escribirla.
    const raw = JSON.parse(decodeURIComponent(valor)) as Partial<Yo>;
    if (typeof raw.id !== "number") return null;
    return {
      id: raw.id,
      nombre: typeof raw.nombre === "string" ? raw.nombre : "",
      permisos: Array.isArray(raw.permisos) ? (raw.permisos as Permiso[]) : [],
      tiendas: Array.isArray(raw.tiendas) ? raw.tiendas.filter((x): x is string => typeof x === "string") : [],
      staffId: typeof raw.staffId === "number" ? raw.staffId : null,
      debeCambiar: raw.debeCambiar === true,
    };
  } catch {
    return null;
  }
}

/** Lee la cookie en el navegador. En el servidor devuelve null. */
export function leerYo(): Yo | null {
  if (typeof document === "undefined") return null;
  const par = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_YO}=`));
  return yoDeCookie(par?.slice(COOKIE_YO.length + 1));
}

export function tienePermiso(yo: Yo | null, p: Permiso): boolean {
  return Boolean(yo?.permisos.includes(p));
}

/** La asesora queda fija si ES una asesora y no supervisa. */
export function asesoraFija(yo: Yo | null): number | null {
  return yo?.staffId && !yo.permisos.includes("leads_equipo") ? yo.staffId : null;
}
