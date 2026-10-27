// Que datos de la planilla (payroll_staff) ve cada quien.
//
// La lista de asesoras la necesita cualquiera con sesion (selector "quien eres"
// de Leads, detalle de pedido), pero solo para mostrar nombres: correo, usuario
// de iComfly y extension de Zadarma son de quien administra personal.
//
// Puro: se prueba en tests/planilla-publica.test.ts.

import type { PayrollStaff } from "./finance-types";

export type PlanillaPublica = Pick<PayrollStaff, "id" | "name" | "role" | "active">;

/** true si con estos permisos se ve la planilla completa. null = proceso del sistema. */
export function veePlanillaCompleta(permisos: readonly string[] | null): boolean {
  return permisos === null || permisos.includes("finanzas") || permisos.includes("usuarios");
}

export function planillaPara(
  staff: PayrollStaff[],
  permisos: readonly string[] | null
): PayrollStaff[] | PlanillaPublica[] {
  if (veePlanillaCompleta(permisos)) return staff;
  return staff.map(({ id, name, role, active }) => ({ id, name, role, active }));
}
