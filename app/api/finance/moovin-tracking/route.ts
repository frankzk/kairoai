import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Tracking de Moovin: la pagina publica es una app Next.js con Server Actions.
// No hay API REST; se replica la llamada POST con el header next-action y el
// body con la guia. El id de la accion cambia cuando Moovin redespliega su
// app, por eso es configurable por env (MOOVIN_NEXT_ACTION) sin tocar codigo.
const MOOVIN_BASE = "https://utilities.moovin.me";
const MOOVIN_NEXT_ACTION =
  process.env.MOOVIN_NEXT_ACTION || "7fae531bab4ee20b1f874b0fafcfa412a52a5a165f";
// Cookie opcional por si Moovin exige sesion; normalmente no hace falta.
const MOOVIN_COOKIE = process.env.MOOVIN_COOKIE || "";

// Codigos de estado de Moovin agrupados en un estado interno reconciliable
// con el seguimiento de Boxful/Shopify.
const MOOVIN_STATUS_GROUP: Record<string, "delivered" | "failed" | "returned" | "in_progress"> = {
  DELIVERED: "delivered",
  FAILED: "failed",
  RETURNED: "returned",
  RETURN: "returned",
  RETURNTOSENDER: "returned",
};

export async function GET(req: NextRequest) {
  const idPackage = (req.nextUrl.searchParams.get("idPackage") || "").trim();
  const lastName = (req.nextUrl.searchParams.get("lastName") || "").trim();
  const includeRaw = req.nextUrl.searchParams.get("raw") === "1";
  if (!idPackage) {
    return NextResponse.json({ error: "idPackage requerido" }, { status: 400 });
  }

  const pageUrl = `${MOOVIN_BASE}/?tracking/lastName=${encodeURIComponent(
    lastName
  )}&idPackage=${encodeURIComponent(idPackage)}`;
  const routerStateTree = JSON.stringify([
    "",
    {
      children: ["__PAGE__", {}, `/?tracking/lastName=${lastName}&idPackage=${idPackage}`, "refresh"],
    },
    null,
    null,
    true,
  ]);

  try {
    const res = await fetch(pageUrl, {
      method: "POST",
      headers: {
        accept: "text/x-component",
        "content-type": "text/plain;charset=UTF-8",
        "next-action": MOOVIN_NEXT_ACTION,
        "next-router-state-tree": routerStateTree,
        origin: MOOVIN_BASE,
        referer: pageUrl,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ...(MOOVIN_COOKIE ? { cookie: MOOVIN_COOKIE } : {}),
      },
      body: JSON.stringify([idPackage, "", ""]),
      cache: "no-store",
    });

    const text = await res.text();
    const detail = parseMoovinResponse(text);
    if (!detail) {
      return NextResponse.json({
        ok: false,
        http_status: res.status,
        id_package: idPackage,
        error: "No se pudo interpretar la respuesta de Moovin",
        ...(includeRaw ? { raw: text.slice(0, 20000) } : {}),
      });
    }

    const latest = detail.events[0] ?? null;
    return NextResponse.json({
      ok: res.ok,
      http_status: res.status,
      id_package: idPackage,
      tracking_number: detail.tracking_number,
      profile: detail.profile,
      latest_status: latest?.title ?? null,
      latest_status_code: latest?.code ?? null,
      latest_group: latest?.group ?? null,
      latest_at: latest?.date ?? null,
      delivery_address: detail.delivery_address,
      events: detail.events,
      ...(includeRaw ? { raw: text.slice(0, 20000) } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error consultando Moovin";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

interface MoovinEvent {
  code: string;
  group: "delivered" | "failed" | "returned" | "in_progress";
  title: string;
  description: string;
  date: string | null;
  note: string;
}

interface MoovinDetail {
  tracking_number: string;
  profile: string;
  delivery_address: string;
  events: MoovinEvent[];
}

interface RawStatus {
  idStatus?: number;
  date?: string;
  status?: string;
  title?: string;
  description?: string;
  comments?: Array<{ value?: string; reason?: string }>;
}

interface RawPayload {
  serialNumber?: string;
  nameProfile?: string;
  listStatus?: RawStatus[];
  coorList?: Array<{ name?: string; address?: string }>;
}

// La respuesta RSC son lineas "<id>:<json>"; el payload de tracking es la
// linea cuyo JSON tiene listStatus. Se parsea ese objeto directamente.
function parseMoovinResponse(raw: string): MoovinDetail | null {
  const payload = findTrackingPayload(raw);
  if (!payload || !Array.isArray(payload.listStatus)) return null;

  const events: MoovinEvent[] = payload.listStatus
    .map((status) => {
      const code = String(status.status ?? "").toUpperCase();
      const note = (status.comments ?? [])
        .map((comment) => [comment.reason, comment.value].filter(Boolean).join(": "))
        .filter(Boolean)
        .join(" | ");
      return {
        code,
        group: MOOVIN_STATUS_GROUP[code] ?? "in_progress",
        title: String(status.title ?? ""),
        description: String(status.description ?? ""),
        date: status.date ?? null,
        note,
      };
    })
    // Mas reciente primero: por fecha y, a igualdad, por idStatus.
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  const delivery = (payload.coorList ?? []).find((point) =>
    String(point.name ?? "").toLowerCase().includes("entrega")
  );

  return {
    tracking_number: String(payload.serialNumber ?? ""),
    profile: String(payload.nameProfile ?? ""),
    delivery_address: String(delivery?.address ?? ""),
    events,
  };
}

function findTrackingPayload(raw: string): RawPayload | null {
  for (const line of raw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const jsonPart = line.slice(colon + 1).trim();
    if (!jsonPart.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(jsonPart) as RawPayload;
      if (parsed && Array.isArray(parsed.listStatus)) return parsed;
    } catch {
      // Linea no-JSON o truncada; se ignora.
    }
  }
  return null;
}
