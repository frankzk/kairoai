import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  deleteQuickReply,
  updateQuickReply,
  QUICK_REPLY_MAX_BODY,
  QUICK_REPLY_MAX_TITLE,
} from "@/lib/quick-replies";

export const runtime = "nodejs";
export const maxDuration = 20;

interface PatchBody {
  store?: string;
  title?: string;
  body?: string;
}

// PATCH /api/quick-replies/[id] — edita nombre y/o mensaje.
export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const payload = (await req.json().catch(() => null)) as PatchBody | null;
  const store = getRequiredStoreFromBody(payload);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  const title = payload?.title !== undefined ? String(payload.title).trim() : undefined;
  const body = payload?.body !== undefined ? String(payload.body).trim() : undefined;
  if (title !== undefined && !title) {
    return NextResponse.json({ error: "El nombre no puede quedar vacio." }, { status: 400 });
  }
  if (body !== undefined && !body) {
    return NextResponse.json({ error: "El mensaje no puede quedar vacio." }, { status: 400 });
  }
  if (title !== undefined && title.length > QUICK_REPLY_MAX_TITLE) {
    return NextResponse.json(
      { error: `El nombre supera ${QUICK_REPLY_MAX_TITLE} caracteres.` },
      { status: 400 }
    );
  }
  if (body !== undefined && body.length > QUICK_REPLY_MAX_BODY) {
    return NextResponse.json(
      { error: `El mensaje supera ${QUICK_REPLY_MAX_BODY} caracteres.` },
      { status: 400 }
    );
  }
  if (title === undefined && body === undefined) {
    return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
  }

  try {
    const reply = await updateQuickReply({ storeId: store.id, id, title, body });
    if (!reply) return NextResponse.json({ error: "respuesta no encontrada" }, { status: 404 });
    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al actualizar la respuesta";
    const conflict = message.includes("Ya existe");
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}

// DELETE /api/quick-replies/[id]?store= — borrado logico.
export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  try {
    const removed = await deleteQuickReply(store.id, id);
    if (!removed) return NextResponse.json({ error: "respuesta no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al borrar la respuesta";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
