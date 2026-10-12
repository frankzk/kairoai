// Validacion de los datos de un usuario al crearlo o editarlo. Puro: se prueba
// en tests/usuarios.test.ts.

import { normalizarPermisos, type Permiso, type Rol } from "./permisos";
import { normalizarEmail, normalizarRoles, normalizarTiendas, problemaDeEmail } from "./usuarios";

export interface DatosAcceso {
  nombre: string;
  email: string | null;
  roles: Rol[];
  permisos: Permiso[];
  tiendas: string[];
  staff_id: number | null;
}

/** Lee y valida roles, permisos, tiendas y asesora. Devuelve error o datos. */
export function validarAcceso(body: Record<string, unknown>): { error: string } | { datos: DatosAcceso } {
  const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
  if (nombre.length < 2 || nombre.length > 60) return { error: "Escribe el nombre de la persona (2 a 60 caracteres)." };

  const email = normalizarEmail(body.email);
  const problemaE = problemaDeEmail(email);
  if (problemaE) return { error: problemaE };

  const permisos = normalizarPermisos(body.permisos);
  if (!permisos.length) return { error: "Marca al menos una pantalla a la que tenga acceso." };

  const tiendas = normalizarTiendas(body.tiendas);
  if (!tiendas.length) return { error: "Marca al menos una tienda (Costa Rica u Honduras)." };

  const staffRaw = body.staff_id;
  const staffNum = staffRaw === null || staffRaw === "" || staffRaw === undefined ? null : Number(staffRaw);
  if (staffNum !== null && (!Number.isInteger(staffNum) || staffNum <= 0)) return { error: "Asesora de planilla inválida." };

  // Una asesora sin supervision gestiona SIEMPRE a su nombre: tiene que saberse
  // cual es. Sin esto el servidor no puede fijarla y volveria a elegirse de la
  // lista, que es justo lo que se quiere evitar.
  if (permisos.includes("leads") && !permisos.includes("leads_equipo") && staffNum === null) {
    return { error: "Para dar acceso a Leads, vincula a la persona con su nombre de la planilla de asesoras." };
  }

  return { datos: { nombre, email, roles: normalizarRoles(body.roles), permisos, tiendas, staff_id: staffNum } };
}
