import { NextRequest, NextResponse } from "next/server";
import {
  createPayrollStaff,
  deletePayrollStaff,
  listPayrollStaff,
  updatePayrollStaffZadarma,
} from "@/lib/finance";

export const runtime = "nodejs";

export async function GET() {
  try {
    const staff = await listPayrollStaff();
    return NextResponse.json({ staff });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer personal";
    return NextResponse.json({ staff: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const role = String(body.role ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }
    const member = await createPayrollStaff({ name, role });
    return NextResponse.json({ member });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al registrar personal";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta la tabla payroll_staff: ejecuta supabase/migrations/0004_payroll_staff.sql en Supabase."
      : message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}

// PATCH: asigna la extension de la centralita Zadarma a una persona.
// `zadarma_sip: null` la libera.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "id requerido" }, { status: 400 });
    }
    if (!("zadarma_sip" in body)) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }
    const raw = body.zadarma_sip;
    const sip = raw == null || String(raw).trim() === "" ? null : String(raw).trim();
    const member = await updatePayrollStaffZadarma(id, sip);
    return NextResponse.json({ member });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al asignar la extensión";
    const friendly = /zadarma_sip|column/.test(message)
      ? "Falta la columna payroll_staff.zadarma_sip: ejecuta supabase/migrations/0029_zadarma_calls.sql en Supabase."
      : message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  try {
    await deletePayrollStaff(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al eliminar personal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
