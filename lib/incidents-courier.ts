import type { Incident } from "./incidents-types";

const LABELS: Record<string, string> = {
  moovin: "Moovin", wyn: "WYN / MailAmericas", forza: "Forza",
  cargoexpreso: "Cargo Expreso", c807: "c807 Xpress",
};
const ALIASES: Record<string, string> = {
  moovin: "moovin", wyn: "wyn", mailamericas: "wyn", wynmailamericas: "wyn",
  forza: "forza", cargoexpreso: "cargoexpreso", c807: "c807", c807xpress: "c807",
};

/** Courier is the carrier; manual/Boxful describe ingestion, not a carrier. */
export function incidentCourier(incident: Pick<Incident, "courier" | "source">): { key: string; label: string } {
  const raw = (incident.courier || "").trim().replace(/\s+/g, " ");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const alias = Object.hasOwn(ALIASES, normalized) ? ALIASES[normalized] : null;
  if (alias) return { key: alias, label: LABELS[alias] };
  if (raw) return { key: `other:${raw.toLowerCase()}`, label: raw };
  if (LABELS[incident.source]) return { key: incident.source, label: LABELS[incident.source] };
  return { key: "unknown", label: "Sin transportadora" };
}

export function matchesIncidentCourier(incident: Pick<Incident, "courier" | "source">, filter: string): boolean {
  return !filter || incidentCourier(incident).key === filter;
}
