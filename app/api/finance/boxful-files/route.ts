import { NextRequest, NextResponse } from "next/server";
import { listBoxfulFileControls, upsertBoxfulFileControl } from "@/lib/finance";

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.file_name || !body?.file_type) {
    return NextResponse.json({ error: "file_name y file_type requeridos" }, { status: 400 });
  }

  try {
    const file = await upsertBoxfulFileControl({
      file_name: body.file_name,
      file_type: body.file_type,
      cutoff_date: body.cutoff_date || null,
      status: body.status || "esperado",
      notes: body.notes || "",
    });
    return NextResponse.json({ file });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al guardar archivo Boxful";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
