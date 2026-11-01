import { NextResponse } from "next/server";
import { proveedorTelefonia } from "@/lib/telnyx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: que telefono usan las asesoras (TELEFONIA=telnyx | zadarma). Lo leen
// el boton "Llamar" y el telefono web para montar uno u otro sin compilar de
// nuevo.
export async function GET() {
  return NextResponse.json({ proveedor: proveedorTelefonia() });
}
