import { esConfirmadaIcomfly } from "./icomfly-estado-venta";
import type { DispatchView } from "./dispatch";

export const DISPATCH_SUBSTAGES = [
  {
    value: "por_solicitar",
    label: "Pendiente de solicitar",
    description: "Confirmado en iComfly; falta solicitar su despacho.",
  },
  {
    value: "esperando_guia",
    label: "Esperando guía",
    description:
      "Solicitud de despacho registrada; todavía sin guía sincronizada.",
  },
  {
    value: "esperando_recoleccion",
    label: "Esperando recolección",
    description:
      "Ya tiene guía; la transportadora aún reporta la recolección pendiente.",
  },
] as const;

export type DispatchSubstage = (typeof DISPATCH_SUBSTAGES)[number]["value"];
export type DispatchSubstageFilter = "all" | DispatchSubstage;
export type DispatchSubstageCounts = Record<DispatchSubstageFilter, number>;

export function parseDispatchSubstage(
  value: string | null,
): DispatchSubstageFilter {
  return DISPATCH_SUBSTAGES.some((s) => s.value === value)
    ? (value as DispatchSubstage)
    : "all";
}

/** Agrupacion operativa; no altera la solicitud real ni su atribucion en iComfly. */
export function getDispatchSubstage(
  status: string,
  row: {
    guide_number?: string | null;
    icomfly_estado?: string | null;
    dispatch_view?: DispatchView | null;
    dispatch_requested_by?: string | null;
  },
): DispatchSubstage | null {
  if (status !== "despacho_solicitado") return null;
  if (row.guide_number?.trim()) return "esperando_recoleccion";
  if (
    esConfirmadaIcomfly(row.icomfly_estado) &&
    row.dispatch_view !== "despacho_solicitado" &&
    !row.dispatch_requested_by?.trim()
  ) {
    return "por_solicitar";
  }
  return "esperando_guia";
}

export function dispatchSubstageLabel(substage: DispatchSubstage): string {
  return DISPATCH_SUBSTAGES.find((s) => s.value === substage)!.label;
}
