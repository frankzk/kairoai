import { NextResponse } from "next/server";
import { listBoxfulFileControls } from "@/lib/finance";

export const runtime = "nodejs";

export async function GET() {
  try {
    const files = await listBoxfulFileControls();
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer control de archivos Boxful";
    return NextResponse.json({ files: [], error: message }, { status: 500 });
  }
}
