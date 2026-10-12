// Quien llama, dentro de una ruta del servidor.
//
// El middleware ya valido y revalido la sesion y dejo la identidad en un header
// interno (borrando el que haya mandado el navegador). Aca solo se lee.
//
// Fuera de un pedido (crons programados, scripts, tests) no hay identidad y
// devuelve null: esos procesos no tienen restricciones de persona.

import { headers } from "next/headers";
import { HEADER_USUARIO, identidadDeHeader, type Identidad } from "./auth";

export function identidadActual(): Identidad | null {
  try {
    return identidadDeHeader(headers().get(HEADER_USUARIO));
  } catch {
    return null;
  }
}

/**
 * Tiendas que puede trabajar quien llama, o null si no hay restriccion (un
 * proceso del sistema, sin persona).
 */
export function tiendasPermitidas(): string[] | null {
  const yo = identidadActual();
  return yo ? yo.tiendas : null;
}

/**
 * A nombre de que asesora queda una gestion, un mensaje o una llamada.
 *
 * Si quien llama ES una asesora (tiene staff_id) y no tiene permiso de
 * supervision, queda SIEMPRE a su nombre, mande lo que mande el navegador: asi
 * nadie registra a nombre de otra. Supervision y procesos del sistema usan lo
 * que viene en el pedido.
 */
export function vendedoraEfectiva(pedida: unknown): number | null {
  const yo = identidadActual();
  if (yo?.staffId && !yo.permisos.includes("leads_equipo")) return yo.staffId;
  const n = Number(pedida);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Nombre de quien hace la accion, para bitacoras. */
export function actorActual(): string {
  return identidadActual()?.nombre || "sistema";
}
