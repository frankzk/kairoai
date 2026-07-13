// Fase de transito de un paquete Moovin, derivada del ULTIMO estado (codigo o
// titulo). Es lo que agrupa el "Estado de seguimiento" en la UI:
//   - despacho_solicitado: aun en el almacen del remitente (registrado / por
//     preparar / recoleccion solicitada o programada).
//   - recolectado: ya recogido, dentro de la red de Moovin y antes de salir a
//     repartir (recolectado / precoordinacion / sede de Moovin / en sede local).
//   - en_route: ya en reparto (coordinado / en ruta a lo largo del dia).
// Devuelve null cuando el paquete NO esta en transito (estado final/incidencia/
// cancelado o sin dato): esos se clasifican en otra capa y no deben tocarse aqui.
//
// Modulo PURO (sin imports de servidor) para poder reutilizarse en cliente,
// servidor y vitest sin arrastrar el alias @/.

export type MoovinTransitPhase = "despacho_solicitado" | "recolectado" | "en_route";

export interface MoovinPhaseInput {
  latest_code?: string | null;
  latest_status?: string | null; // titulo en español
  latest_group?: string | null;
}

// Mapeo por CODIGO de Moovin (fuente mas confiable que el titulo).
const PHASE_BY_CODE: Record<string, MoovinTransitPhase> = {
  PREPARE: "despacho_solicitado", // Por preparar
  PICKUP: "despacho_solicitado", // Recoleccion solicitada
  INMOOVIN: "recolectado", // Sede de Moovin
  RECIEVEDDELEGATED: "recolectado", // En sede local (typo "RECIEVED" es de Moovin)
  COORDINATE: "en_route", // Coordinado
  INROUTE: "en_route", // En ruta para entregar a lo largo del dia
};

// Fallback por TITULO para los estados sin codigo conocido (Registrado,
// Recoleccion programada, Recolectado, Precoordinacion confirmada/enviada).
// ORDEN CRITICO: "recolectad" antes que "recolec"; "precoordin"/"preecoordin"
// antes que "coordinad".
function phaseByTitle(title: string): MoovinTransitPhase | null {
  if (title.includes("recolectad")) return "recolectado"; // Recolectado
  if (title.includes("precoordin") || title.includes("preecoordin")) return "recolectado";
  if (title.includes("sede")) return "recolectado"; // Sede de Moovin, En sede local
  if (title.includes("en ruta")) return "en_route";
  if (title.includes("coordinad")) return "en_route"; // Coordinado (precoordin ya cubierto)
  if (title.includes("registrad")) return "despacho_solicitado"; // Registrado
  if (title.includes("preparar")) return "despacho_solicitado"; // Por preparar
  if (title.includes("recolec")) return "despacho_solicitado"; // Recoleccion solicitada/programada
  return null;
}

export function moovinTransitPhase(input: MoovinPhaseInput): MoovinTransitPhase | null {
  const code = String(input.latest_code ?? "").toUpperCase();
  const title = String(input.latest_status ?? "").toLowerCase();
  const group = String(input.latest_group ?? "");

  // Solo aplica a paquetes en transito. Cancelados y estados finales
  // (delivered/failed/returned) se clasifican en otra capa.
  if (code.startsWith("CANCEL") || title.includes("cancelado")) return null;
  if (group && group !== "in_progress") return null;
  if (!code && !title) return null;

  const byCode = PHASE_BY_CODE[code];
  if (byCode) return byCode;
  const byTitle = phaseByTitle(title);
  if (byTitle) return byTitle;

  // Estado en transito no catalogado: por defecto En ruta, y se avisa para
  // detectar estados nuevos de Moovin que haya que mapear.
  if (typeof console !== "undefined") {
    console.warn(`[moovin] estado en transito sin clasificar -> en_route: code="${code}" title="${title}"`);
  }
  return "en_route";
}
