// Cliente y parser del rastreo de Cargo Expreso (Honduras).
//
// POR QUE EXISTE: Cargo Expreso lleva parte de los envios de Mireva Honduras
// (guias BH...-1) y no tenia seguimiento en Kairo: sus entregas fallidas nunca
// llegaban a Novedades. Su pagina publica de rastreo (www2.cargoexpreso.com)
// consulta esta API, que devuelve cada escaneo del paquete. A diferencia de
// Forza, si informa cada intento de entrega con su motivo ("005 Nadie en casa",
// "003 Cliente no tiene dinero"...) y la devolucion ("CANCELADO POR
// DEVOLUCION"). De 60 guias de septiembre y octubre, 22 terminaron devueltas.
//
// Codigos de movimiento (EstadoMovimiento), vistos en esas 60 guias:
//   R  recolectado · I ingreso a bodega · E salida de bodega · A asignacion de
//   carga · T en transito · D intento de entrega: el motivo va en NombreRuta,
//   "001 Entregando-Paquete" es la entrega · NO / NC se registran junto con
//   cada D con el mismo motivo (no son otro intento) · X cierre administrativo:
//   "CANCELADO POR DEVOLUCION" o "COBERTURA" (destino fuera de su zona).

const CAEX_TRACKING_ENDPOINT = "https://wshn2.caexlogistics.com/cdvhn/api/Tracking/Get";
const CAEX_ORIGIN = "https://www2.cargoexpreso.com";

export type CargoExpresoGroup = "delivered" | "failed" | "returned" | "in_progress" | "pending";

export interface CargoExpresoEvent {
  code: string;
  group: CargoExpresoGroup;
  title: string;
  description: string;
  date: string | null;
  note: string;
}

export interface CargoExpresoTracking {
  guideNumber: string;
  latestStatus: string;
  latestCode: string;
  latestGroup: CargoExpresoGroup;
  latestAt: string | null;
  hasIncident: boolean;
  incidentReason: string;
  deliveryAddress: string;
  receiverName: string;
  /** Del mas reciente al mas viejo. */
  events: CargoExpresoEvent[];
}

type RawScan = {
  FechaHoraScan?: unknown;
  HUB?: unknown;
  NombreRuta?: unknown;
  TipoMovimiento?: unknown;
  EstadoMovimiento?: unknown;
};

type RawGuia = {
  NumeroGuia?: unknown;
  DestinatarioNombre?: unknown;
  DestinatarioDireccion?: unknown;
  PODNombre?: unknown;
  PODStatus?: unknown;
  PODStatusDes?: unknown;
  detalle?: unknown;
};

export function normalizeCargoExpresoGuide(value?: string | null): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Guias de Cargo Expreso Honduras: BH + digitos + "-" + pieza (p.ej. BH000000001-1). */
export function isCargoExpresoGuide(value?: string | null): boolean {
  return /^BH\d{6,}-\d+$/.test(normalizeCargoExpresoGuide(value));
}

function texto(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

// "TO305 - 005 Nadie en casa" -> "005 Nadie en casa". Las rutas de transito
// traen "SR602 - RUTA OCOTEPEQUE" y salen igual, solo se usa para D.
function motivo(nombreRuta: string): string {
  const i = nombreRuta.indexOf(" - ");
  return (i >= 0 ? nombreRuta.slice(i + 3) : nombreRuta).replace(/\s+/g, " ").trim();
}

function esEntrega(motivoTexto: string): boolean {
  return motivoTexto.startsWith("001");
}

// "2026-10-05 11:23:51" en hora de Honduras (UTC-6, sin horario de verano).
function fecha(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  return m ? new Date(`${m[1]}T${m[2]}-06:00`).toISOString() : null;
}

function aEvento(scan: RawScan): CargoExpresoEvent | null {
  const codigo = texto(scan.EstadoMovimiento).toUpperCase();
  // NO / NC repiten el motivo del intento (D) que registran al lado.
  if (!codigo || codigo === "NO" || codigo === "NC") return null;
  const ruta = texto(scan.NombreRuta);
  const tipo = texto(scan.TipoMovimiento);
  const hub = texto(scan.HUB);
  const base = { code: codigo, description: ruta, date: fecha(texto(scan.FechaHoraScan)), note: hub };
  switch (codigo) {
    case "D": {
      const m = motivo(ruta);
      return esEntrega(m)
        ? { ...base, group: "delivered", title: "Entregado" }
        : { ...base, group: "failed", title: `Intento de entrega fallido: ${m}`, description: m };
    }
    case "X":
      return /DEVOLUCION/i.test(tipo)
        ? { ...base, group: "returned", title: "Devuelto (cancelado por devolucion)" }
        : { ...base, group: "in_progress", title: /COBERTURA/i.test(tipo) ? "Destino fuera de cobertura" : tipo || "Cierre" };
    case "R":
      return { ...base, group: "pending", title: "Recolectado" };
    case "I":
      return { ...base, group: "in_progress", title: `Ingreso a bodega${hub ? ` (${hub})` : ""}` };
    case "E":
    case "T":
      return { ...base, group: "in_progress", title: `Salida de bodega${hub ? ` (${hub})` : ""}` };
    case "A":
      return { ...base, group: "in_progress", title: "Asignado a ruta de entrega" };
    default:
      return { ...base, group: "in_progress", title: tipo || `Movimiento ${codigo}` };
  }
}

/**
 * Estado vigente de la guia.
 * - Entregada: POD 5 o un intento "001 Entregando-Paquete".
 * - Devuelta: "CANCELADO POR DEVOLUCION".
 * - Intento fallido activo: el ultimo intento fallo y el paquete no volvio a
 *   salir a entrega (sigue en bodega esperando gestion).
 * - Si volvio a salir despues de la falla, es un reintento en curso.
 */
function estadoVigente(eventos: CargoExpresoEvent[], podStatus: string): {
  group: CargoExpresoGroup;
  ultimaFalla: CargoExpresoEvent | null;
} {
  const cronologico = [...eventos].reverse();
  if (podStatus === "5" || eventos.some((e) => e.group === "delivered")) return { group: "delivered", ultimaFalla: null };
  if (eventos.some((e) => e.group === "returned")) return { group: "returned", ultimaFalla: null };
  let ultimaFalla: CargoExpresoEvent | null = null;
  let salioDespues = false;
  for (const e of cronologico) {
    if (e.group === "failed") {
      ultimaFalla = e;
      salioDespues = false;
    } else if (ultimaFalla && (e.code === "E" || e.code === "A" || e.code === "T")) {
      salioDespues = true;
    }
  }
  if (ultimaFalla && !salioDespues) return { group: "failed", ultimaFalla };
  if (eventos.every((e) => e.group === "pending")) return { group: "pending", ultimaFalla: null };
  return { group: "in_progress", ultimaFalla: null };
}

/** Interpreta la respuesta de la API. Null si no trae la guia. Exportado para tests. */
export function parseCargoExpresoResponse(payload: unknown): CargoExpresoTracking | null {
  const tracking = (payload as { tracking?: { resultado?: unknown; datosGuia?: RawGuia } } | null)?.tracking;
  const guia = tracking?.datosGuia;
  if (!tracking?.resultado || !guia) return null;
  const scans = Array.isArray(guia.detalle) ? (guia.detalle as RawScan[]) : [];
  const eventos = scans
    .map(aEvento)
    .filter((e): e is CargoExpresoEvent => e !== null)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const { group, ultimaFalla } = estadoVigente(eventos, texto(guia.PODStatus));
  const latest = eventos[0] ?? null;
  const latestStatus =
    group === "delivered" ? "Entregado"
    : group === "returned" ? "Devuelto"
    : group === "failed" && ultimaFalla ? ultimaFalla.title
    : texto(guia.PODStatusDes) || latest?.title || "Sin movimientos";
  return {
    guideNumber: normalizeCargoExpresoGuide(texto(guia.NumeroGuia)),
    latestStatus,
    latestCode: group === "failed" && ultimaFalla ? ultimaFalla.code : latest?.code ?? "",
    latestGroup: group,
    latestAt: (group === "failed" ? ultimaFalla?.date : latest?.date) ?? null,
    hasIncident: group === "failed",
    incidentReason: group === "failed" && ultimaFalla ? ultimaFalla.description : "",
    deliveryAddress: texto(guia.DestinatarioDireccion),
    receiverName: texto(guia.PODNombre),
    events: eventos,
  };
}

export async function fetchCargoExpresoTracking(guide: string): Promise<CargoExpresoTracking> {
  const guideNumber = normalizeCargoExpresoGuide(guide);
  if (!isCargoExpresoGuide(guideNumber)) throw new Error("La guia no tiene formato de Cargo Expreso.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${CAEX_TRACKING_ENDPOINT}?guia=${encodeURIComponent(guideNumber)}`, {
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        origin: CAEX_ORIGIN,
        referer: `${CAEX_ORIGIN}/`,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("Cargo Expreso no respondio en 15 segundos.");
    throw new Error(err instanceof Error ? err.message : "No se pudo consultar Cargo Expreso.");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`Cargo Expreso respondio HTTP ${res.status}.`);
  const parsed = parseCargoExpresoResponse(await res.json().catch(() => null));
  if (!parsed) throw new Error("Cargo Expreso no encontro informacion para esta guia.");
  return parsed;
}
