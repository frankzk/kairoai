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

/** Clave YYYY-MM-DD del instante en la hora local de la tienda. */
export function localDateKey(
  value: Date | string | null | undefined,
  offsetHours = -6
): string | null {
  if (value == null || value === "") return null;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return null;

  const local = new Date(instant.getTime() + offsetHours * 3600_000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Comprueba un instante contra un rango inclusivo de dias locales. */
export function matchesLocalDateRange(
  value: Date | string | null | undefined,
  fromDate: string,
  toDate: string,
  offsetHours = -6
): boolean {
  if (!fromDate && !toDate) return true;
  const date = localDateKey(value, offsetHours);
  if (!date) return false;
  return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
}

/** Ultimos `days` dias calendario locales, en orden cronologico. */
export function recentLocalDateKeys(now: Date, days: number, offsetHours = -6): string[] {
  const safeDays = Math.max(0, Math.floor(days));
  const offsetMs = offsetHours * 3600_000;
  const localNow = new Date(now.getTime() + offsetMs);
  const localToday = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate()
  );

  return Array.from({ length: safeDays }, (_, index) => {
    const localDay = new Date(localToday - (safeDays - index - 1) * 86400_000);
    const year = localDay.getUTCFullYear();
    const month = String(localDay.getUTCMonth() + 1).padStart(2, "0");
    const day = String(localDay.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
}

export interface UncalledLeadMetricInput {
  status_source: string;
  first_seen_at?: string | null;
  created_at?: string | null;
  last_interaction_at?: string | null;
}

export interface UncalledLeadDay {
  date: string;
  count: number;
}

/** Fecha de entrada usada tanto por el grafico como por el filtro de la lista. */
export function uncalledLeadDateKey(
  lead: UncalledLeadMetricInput,
  offsetHours = -6
): string | null {
  return localDateKey(
    lead.first_seen_at ?? lead.created_at ?? lead.last_interaction_at,
    offsetHours
  );
}

/** Un lead esta "sin llamar" mientras no tenga una gestion manual. */
export function isUncalledLeadOnDate(
  lead: UncalledLeadMetricInput,
  date: string,
  offsetHours = -6
): boolean {
  return lead.status_source === "auto" && uncalledLeadDateKey(lead, offsetHours) === date;
}

/** Serie diaria completa (incluye dias con cero) para el grafico operativo. */
export function buildUncalledLeadSeries(
  leads: UncalledLeadMetricInput[],
  now: Date,
  days: number,
  offsetHours = -6
): UncalledLeadDay[] {
  const dates = recentLocalDateKeys(now, days, offsetHours);
  const countsByDay = new Map(dates.map((date) => [date, 0]));

  for (const lead of leads) {
    if (lead.status_source !== "auto") continue;
    const date = uncalledLeadDateKey(lead, offsetHours);
    if (date && countsByDay.has(date)) {
      countsByDay.set(date, (countsByDay.get(date) ?? 0) + 1);
    }
  }

  return dates.map((date) => ({ date, count: countsByDay.get(date) ?? 0 }));
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
