import { NextRequest, NextResponse } from "next/server";
import { listBoxfulFileControls } from "@/lib/finance";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    const files = await listBoxfulFileControls(store.id);
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer control de archivos Boxful";
    return NextResponse.json({ files: [], error: message }, { status: 500 });
  }
}
