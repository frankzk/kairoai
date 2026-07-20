// Helpers de rango de fechas para las metricas de Leads, en hora local de la
// tienda (CR y HN son UTC-6, sin horario de verano -> offset fijo). Puros y
// testeables (tests/leads-metrics.test.ts).

export type RangeKey = "hoy" | "ayer" | "7d" | "30d" | "mes";

export const RANGE_LABELS: Record<RangeKey, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
};

export function parseRange(value: unknown): RangeKey {
  const v = String(value ?? "").toLowerCase();
  return (["hoy", "ayer", "7d", "30d", "mes"] as RangeKey[]).includes(v as RangeKey)
    ? (v as RangeKey)
    : "hoy";
}

/** ISO de hace `days` dias (rolling, sin ajustar a medianoche). */
export function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86400_000).toISOString();
}

/**
 * Rango [fromIso, toIso) para una ventana, calculado sobre el dia local de la
 * tienda (offset fijo). `hoy`/`7d`/`30d`/`mes` terminan en "ahora"; `ayer` es
 * el dia calendario anterior completo.
 */
export function crRange(range: RangeKey, now: Date, offsetHours = -6): { fromIso: string; toIso: string } {
  const offsetMs = offsetHours * 3600_000;
  const local = new Date(now.getTime() + offsetMs); // "reloj" local expresado en UTC
  const startOfLocalDay = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0, 0)
  );
  const toUtc = (d: Date) => new Date(d.getTime() - offsetMs).toISOString();

  let from: Date;
  let to: Date = local;
  switch (range) {
    case "hoy":
      from = startOfLocalDay;
      break;
    case "ayer":
      to = startOfLocalDay;
      from = new Date(startOfLocalDay.getTime() - 86400_000);
      break;
    case "7d":
      from = new Date(local.getTime() - 7 * 86400_000);
      break;
    case "30d":
      from = new Date(local.getTime() - 30 * 86400_000);
      break;
    case "mes":
      from = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 0, 0, 0, 0));
      break;
  }
  return { fromIso: toUtc(from), toIso: toUtc(to) };
}
