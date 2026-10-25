import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { normalizeWooPayload, readWooBody, validWooSignature, WooInputError } from "@/lib/woo-payload";
import { wooEnv, wooStoreId } from "@/lib/woo-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: { storeCode: string } }) {
  if (params.storeCode !== "kenku-it") return NextResponse.json({ error: "Tienda desconocida" }, { status: 404 });
  const env = wooEnv();
  if (!env.secret || !env.origins.length) return NextResponse.json({ error: "Conexión no configurada" }, { status: 503 });
  try {
    const raw = await readWooBody(req);
    if (!validWooSignature(raw, req.headers.get("x-cod-signature"), env.secret)) return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
    if (req.headers.get("x-cod-event") !== "order.created") throw new WooInputError("Evento inválido");
    const payload = normalizeWooPayload(JSON.parse(raw.toString("utf8")), env.origins);
    const { data, error } = await getDB().rpc("woo_receive_order", { p_store: await wooStoreId(), p_payload: payload });
    if (error) throw new Error("Persistence failed");
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    if (err instanceof WooInputError || err instanceof SyntaxError) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
    console.error("[cod-core] No se pudo persistir el pedido");
    return NextResponse.json({ error: "Intenta nuevamente" }, { status: 503 });
  }
}
