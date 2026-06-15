import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
  type ExpenseType,
} from "@/lib/finance";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";

const TYPES = new Set(["ads", "payroll", "misc"]);

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  const rawType = req.nextUrl.searchParams.get("type");
  const type = rawType && TYPES.has(rawType) ? (rawType as ExpenseType) : undefined;

  try {
    const expenses = await listExpenses(type, store.id);
    return NextResponse.json({ expenses });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al leer gastos");
    return NextResponse.json({ expenses: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) return missingStoreResponse();
  if (!body?.type || !TYPES.has(body.type)) {
    return NextResponse.json({ error: "Tipo de gasto invalido" }, { status: 400 });
  }

  try {
    const expense = await createExpense(
      {
        type: body.type,
        expense_date: body.expense_date || new Date().toISOString().slice(0, 10),
        month: body.month || "",
        platform: body.platform || "",
        category: body.category || "",
        description: body.description || "",
        amount: Number(body.amount ?? 0),
        currency: body.currency || "CRC",
        notes: body.notes || "",
      },
      store.id
    );
    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al guardar gasto");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) return missingStoreResponse();
  if (!body?.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    const { id, ...updates } = body;
    await updateExpense(Number(id), updates, store.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al actualizar gasto");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteExpense(id, store.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al eliminar gasto");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function missingStoreResponse() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}
