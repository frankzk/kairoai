import { NextRequest, NextResponse } from "next/server";
import {
  createIncident,
  getIncident,
  listIncidentEvents,
  listIncidents,
  updateIncident,
} from "@/lib/incidents";
import { getStoreFromSearchParams } from "@/lib/stores";
import type { Incident, IncidentCategory, IncidentSource, IncidentStatus } from "@/lib/incidents-types";

export const runtime = "nodejs";

const STATUSES = new Set([
  "pendiente", "reprogramada", "sin_contestar", "no_llamar", "resuelta", "perdida", "descartada",
]);
const CATEGORIES = new Set([
  "fallo_entrega", "direccion_incorrecta", "cliente_no_responde", "cliente_rechaza",
  "devuelto_origen", "dano_paquete", "otro",
]);
const SOURCES = new Set(["moovin", "boxful", "manual"]);

function asStatus(v: string | null): IncidentStatus | undefined {
  return v && STATUSES.has(v) ? (v as IncidentStatus) : undefined;
}
function asCategory(v: string | null): IncidentCategory | undefined {
  return v && CATEGORIES.has(v) ? (v as IncidentCategory) : undefined;
}
function asSource(v: string | null): IncidentSource | undefined {
  return v && SOURCES.has(v) ? (v as IncidentSource) : undefined;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const idParam = sp.get("id");

  try {
    if (idParam) {
      const id = Number(idParam);
      const incident = await getIncident(id);
      if (!incident) return NextResponse.json({ error: "Novedad no encontrada" }, { status: 404 });
      const events = await listIncidentEvents(id);
      return NextResponse.json({ incident, events });
    }

    const incidents = await listIncidents({
      storeId: getStoreFromSearchParams(sp).id,
      status: asStatus(sp.get("status")),
      category: asCategory(sp.get("category")),
      source: asSource(sp.get("source")),
      search: sp.get("q") ?? undefined,
      soloReintento: sp.get("reintento") === "1",
    });
    return NextResponse.json({ incidents });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer novedades";
    return NextResponse.json({ incidents: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || (!body.order_name && !body.guide_number && !body.customer_name && !body.customer_phone)) {
    return NextResponse.json(
      { error: "Indica al menos pedido, guia o datos del cliente" },
      { status: 400 }
    );
  }
  if (body.category && !CATEGORIES.has(body.category)) {
    return NextResponse.json({ error: "Causa invalida" }, { status: 400 });
  }
  if (body.status && !STATUSES.has(body.status)) {
    return NextResponse.json({ error: "Estado invalido" }, { status: 400 });
  }

  try {
    const incident = await createIncident({
      store_id: getStoreFromSearchParams(req.nextUrl.searchParams).id,
      source: "manual",
      order_name: body.order_name ?? "",
      guide_number: body.guide_number ?? "",
      shopify_order_id: body.shopify_order_id ?? "",
      customer_name: body.customer_name ?? "",
      customer_phone: body.customer_phone ?? "",
      courier: body.courier ?? "",
      cod_amount: Number(body.cod_amount ?? 0),
      category: body.category ?? "otro",
      status: body.status ?? "pendiente",
      detail: body.detail ?? "",
      notes: body.notes ?? "",
    });
    return NextResponse.json({ incident }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al crear novedad";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  if (body.status && !STATUSES.has(body.status)) {
    return NextResponse.json({ error: "Estado invalido" }, { status: 400 });
  }
  if (body.category && !CATEGORIES.has(body.category)) {
    return NextResponse.json({ error: "Causa invalida" }, { status: 400 });
  }

  const updates: Partial<Incident> = {};
  for (const key of ["status", "category", "notes", "customer_phone", "detail", "reprogramada_para"] as const) {
    if (key in body) (updates as Record<string, unknown>)[key] = body[key];
  }

  try {
    const incident = await updateIncident(Number(body.id), updates);
    return NextResponse.json({ incident });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al actualizar novedad";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
