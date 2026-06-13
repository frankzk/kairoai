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

// Titulos de estado conocidos de Moovin, del mas avanzado al mas temprano.
// El primero que aparezca en la respuesta es el "ultimo estado" mas probable.
const MOOVIN_STATUS_TITLES = [
  "Entregado por el Moover",
  "Devolución al remitente",
  "Devolucion al remitente",
  "Incidencia en la entrega",
  "Coordinado",
  "En ruta para entregar a lo largo del día",
  "En ruta para entregar a lo largo del dia",
  "Sede de Moovin",
  "En tránsito",
  "En transito",
  "Recolectado",
  "Punto de recolección",
  "Punto de recoleccion",
  "Registrado",
];

export async function GET(req: NextRequest) {
  const idPackage = (req.nextUrl.searchParams.get("idPackage") || "").trim();
  const lastName = (req.nextUrl.searchParams.get("lastName") || "").trim();
  const includeRaw = req.nextUrl.searchParams.get("raw") !== "0";
  if (!idPackage) {
    return NextResponse.json({ error: "idPackage requerido" }, { status: 400 });
  }

  const pageUrl = `${MOOVIN_BASE}/?tracking/lastName=${encodeURIComponent(
    lastName
  )}&idPackage=${encodeURIComponent(idPackage)}`;
  // Replica del next-router-state-tree del navegador para esta ruta.
  const routerStateTree = JSON.stringify([
    "",
    {
      children: [
        "__PAGE__",
        {},
        `/?tracking/lastName=${lastName}&idPackage=${idPackage}`,
        "refresh",
      ],
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
    const events = parseMoovinEvents(text);
    const latest = events[0] ?? null;

    return NextResponse.json({
      ok: res.ok,
      http_status: res.status,
      id_package: idPackage,
      last_name: lastName,
      latest_status: latest?.title ?? null,
      latest_at: latest?.timestamp ?? null,
      events,
      // Respuesta cruda (chica, ~2KB) para validar el formato y afinar el parser.
      ...(includeRaw ? { raw: text.slice(0, 20000) } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error consultando Moovin";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

interface MoovinEvent {
  title: string;
  timestamp: string | null;
  description: string;
}

// Parser best-effort del formato RSC (text/x-component). Busca cada titulo de
// estado conocido en la respuesta y la marca de tiempo mas cercana. Devuelve
// los eventos en el orden del catalogo (mas avanzado primero).
function parseMoovinEvents(raw: string): MoovinEvent[] {
  const found: MoovinEvent[] = [];
  const seen = new Set<string>();
  for (const title of MOOVIN_STATUS_TITLES) {
    const idx = raw.indexOf(title);
    if (idx === -1) continue;
    const key = title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      title,
      timestamp: findNearbyTimestamp(raw, idx),
      description: findNearbyDescription(raw, idx, title),
    });
  }
  return found;
}

// Fecha/hora tipo "11/06/26 16:18" o ISO cerca de la posicion del titulo.
function findNearbyTimestamp(raw: string, near: number): string | null {
  const window = raw.slice(near, near + 400);
  const dmy = window.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}[ T]?\d{0,2}:?\d{0,2}\b/);
  if (dmy) return dmy[0].trim();
  const iso = window.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/);
  return iso ? iso[0] : null;
}

function findNearbyDescription(raw: string, near: number, title: string): string {
  const window = raw.slice(near + title.length, near + title.length + 300);
  const text = window.match(/El [^"\\]{8,200}\./);
  return text ? text[0].trim() : "";
}
