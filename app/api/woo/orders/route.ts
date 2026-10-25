import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { wooAccess, wooStoreId } from "@/lib/woo-server";
import { WOO_STATUS } from "@/lib/woo-config";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!wooAccess()) return NextResponse.json({ error: "Sin acceso a Kenku Italia" }, { status: 403 });
  const page = Math.floor(Math.max(1, Math.min(100000, Number(req.nextUrl.searchParams.get("page")) || 1)));
  const status = req.nextUrl.searchParams.get("status");
  const search = (req.nextUrl.searchParams.get("search") || "").trim();
  try {
    let q = getDB().from("woo_orders").select("id,woo_id,order_number,payload,status,version,synced_version,last_error,created_at", { count: "exact" })
      .eq("store_id", await wooStoreId()).order("created_at", { ascending: false }).order("id", { ascending: false }).range((page-1)*50,page*50-1);
    if (status && Object.prototype.hasOwnProperty.call(WOO_STATUS,status)) q = q.eq("status", status);
    if (search) q = q.ilike("order_number", `%${search.replace(/[%_\\]/g, "").slice(0,80)}%`);
    const { data, count, error } = await q;
    if (error) throw new Error("read failed");
    return NextResponse.json({ orders: data, count, page }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "No se pudieron cargar los pedidos" }, { status: 503 }); }
}
