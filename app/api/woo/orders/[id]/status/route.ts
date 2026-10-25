import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { actorActual } from "@/lib/identidad";
import { wooAccess, wooStoreId, syncWooStatuses } from "@/lib/woo-server";
import { WOO_STATUS } from "@/lib/woo-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!wooAccess()) return NextResponse.json({ error: "Sin acceso a Kenku Italia" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin) return NextResponse.json({ error: "Origen inválido" }, { status: 403 });
  const body = await req.json().catch(() => null), id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !body || !Object.prototype.hasOwnProperty.call(WOO_STATUS, body.status) || !Number.isSafeInteger(body.version) || body.version < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId || "")) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  try {
    const { data, error } = await getDB().rpc("woo_change_status", { p_store: await wooStoreId(), p_id: id, p_expected: body.version, p_status: body.status, p_request: body.requestId, p_actor: actorActual() });
    if (error) throw new Error("write failed");
    if (data.error) return NextResponse.json({ error: data.error === "not_found" ? "Pedido no encontrado" : "El pedido cambió o espera sincronización. Actualiza la lista." }, { status: data.error === "not_found" ? 404 : 409 });
    let sync = { synced: 0, failed: 0 };
    try { sync = await syncWooStatuses(1); } catch { /* durable queue: cron retries */ }
    return NextResponse.json({ ok: true, sync });
  } catch { return NextResponse.json({ error: "No se pudo guardar el cambio" }, { status: 503 }); }
}
