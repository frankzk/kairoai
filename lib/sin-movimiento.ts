// Dias sin movimiento de una guia: desde el ultimo evento que reporto la
// transportadora (WYN, Moovin, Forza, c807/Cargo Expreso). En "En ruta" sirve
// para ver las guias que se quedaron paradas y reclamarlas (el 17/11/2026 eran
// 117 de WYN con mas de 5 dias sin ningun evento nuevo).
//
// Puro: se prueba en tests/sin-movimiento.test.ts.

export const SIN_MOVIMIENTO_CORTES = [5, 10] as const;
export type SinMovimientoFiltro = "all" | "5" | "10";
export const DIAS_ALERTA_SIN_MOVIMIENTO = 5;

const DIA = 86_400_000;

/** Dias completos desde el ultimo movimiento, o null si no hay fecha. */
export function diasSinMovimiento(ultimo: string | null | undefined, ahora = new Date()): number | null {
  if (!ultimo) return null;
  const t = Date.parse(ultimo);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - t) / DIA));
}

export function parseSinMovimiento(value: string | null | undefined): SinMovimientoFiltro {
  return value === "5" || value === "10" ? value : "all";
}

export function pasaSinMovimiento(dias: number | null, filtro: SinMovimientoFiltro): boolean {
  if (filtro === "all") return true;
  return dias != null && dias >= Number(filtro);
}

export interface SinMovimientoCounts {
  all: number;
  "5": number;
  "10": number;
}

export function contarSinMovimiento(dias: Array<number | null>): SinMovimientoCounts {
  return {
    all: dias.length,
    "5": dias.filter((d) => d != null && d >= 5).length,
    "10": dias.filter((d) => d != null && d >= 10).length,
  };
}
