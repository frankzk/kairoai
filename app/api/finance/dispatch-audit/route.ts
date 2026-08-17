import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { runDispatchAudit } from "@/lib/dispatch-audit-db";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET: paquetes cuyo estado real en el courier no coincide con el CRM, y
// paquetes detenidos demasiado tiempo en un mismo punto.
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    const result = await runDispatchAudit({ storeId: store.id });
    return NextResponse.json(result);
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al auditar el despacho");
    return NextResponse.json({ error: message, findings: [] }, { status: 500 });
  }
}
