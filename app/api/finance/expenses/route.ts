import { NextRequest, NextResponse } from "next/server";
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
  type ExpenseType,
} from "@/lib/finance";

export const runtime = "nodejs";

const TYPES = new Set(["ads", "payroll", "misc"]);

export async function GET(req: NextRequest) {
  const rawType = req.nextUrl.searchParams.get("type");
  const type = rawType && TYPES.has(rawType) ? (rawType as ExpenseType) : undefined;

  try {
    const expenses = await listExpenses(type);
    return NextResponse.json({ expenses });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer gastos";
    return NextResponse.json({ expenses: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.type || !TYPES.has(body.type)) {
    return NextResponse.json({ error: "Tipo de gasto invalido" }, { status: 400 });
  }

  try {
    const expense = await createExpense({
      type: body.type,
      expense_date: body.expense_date || new Date().toISOString().slice(0, 10),
      month: body.month || "",
      platform: body.platform || "",
      category: body.category || "",
      description: body.description || "",
      amount: Number(body.amount ?? 0),
      currency: body.currency || "CRC",
      notes: body.notes || "",
    });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al guardar gasto";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    const { id, ...updates } = body;
    await updateExpense(Number(id), updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al actualizar gasto";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteExpense(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al eliminar gasto";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
