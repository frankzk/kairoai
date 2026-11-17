// Dias sin movimiento de una guia: desde el ultimo evento que reporto la
// transportadora (WYN, Moovin, Forza, c807/Cargo Expreso). Sirve para ver las
// guias que se quedaron paradas y reclamarlas.
//
// Cada etapa tiene sus cortes, medidos con las guias de WYN del 17/11/2026:
//   - Despacho solicitado (guia esperando recoleccion): la mitad sale en
//     menos de 1 dia y 8 de cada 10 en 1,2 -> +2 y +4 dias.
//   - Recolectado (en la red del courier): mediana 4,7 dias -> +3 y +7.
//   - En ruta: mediana 4,1, p80 7,2 -> +5 y +10.
//   - Reintento: despues de un intento fallido deberia moverse rapido -> +3 y +5.
// El primer corte es tambien el que pinta en rojo "X dias sin movimiento".
//
// Puro: se prueba en tests/sin-movimiento.test.ts.

export const CORTES_SIN_MOVIMIENTO: Record<string, readonly [number, number]> = {
  despacho_solicitado: [2, 4],
  recolectado: [3, 7],
  en_route: [5, 10],
  en_route_retry: [3, 5],
};

/** Filtro: "all" o los dias de uno de los cortes de la etapa. */
export type SinMovimientoFiltro = "all" | number;

const DIA = 86_400_000;

export const tieneCortes = (estado: string) => estado in CORTES_SIN_MOVIMIENTO;

/** Dias desde los que la etapa se pinta en rojo (null si la etapa no tiene cortes). */
export function diasAlerta(estado: string): number | null {
  return CORTES_SIN_MOVIMIENTO[estado]?.[0] ?? null;
}

/** Dias completos desde el ultimo movimiento, o null si no hay fecha. */
export function diasSinMovimiento(ultimo: string | null | undefined, ahora = new Date()): number | null {
  if (!ultimo) return null;
  const t = Date.parse(ultimo);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - t) / DIA));
}

/** Lee el filtro: solo vale un corte de esa etapa; cualquier otra cosa es "all". */
export function parseSinMovimiento(value: string | null | undefined, estado: string): SinMovimientoFiltro {
  const n = Number(value);
  return CORTES_SIN_MOVIMIENTO[estado]?.includes(n) ? n : "all";
}

export function pasaSinMovimiento(dias: number | null, filtro: SinMovimientoFiltro): boolean {
  if (filtro === "all") return true;
  return dias != null && dias >= filtro;
}

export interface SinMovimientoCounts {
  all: number;
  cortes: Array<{ dias: number; count: number }>;
}

export function contarSinMovimiento(dias: Array<number | null>, estado: string): SinMovimientoCounts | null {
  const cortes = CORTES_SIN_MOVIMIENTO[estado];
  if (!cortes) return null;
  return {
    all: dias.length,
    cortes: cortes.map((corte) => ({ dias: corte, count: dias.filter((d) => d != null && d >= corte).length })),
  };
}
