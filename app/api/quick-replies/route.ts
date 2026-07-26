import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams, getRequiredStoreFromBody } from "@/lib/stores";
import {
  createQuickReply,
  listQuickReplies,
  QUICK_REPLY_MAX_BODY,
  QUICK_REPLY_MAX_TITLE,
} from "@/lib/quick-replies";

export const runtime = "nodejs";
export const maxDuration = 20;

// GET /api/quick-replies?store= — respuestas activas de la tienda, mas usadas
// primero (alimenta los chips y el buscador "/" del composer).
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  try {
    const replies = await listQuickReplies(store.id);
    return NextResponse.json({ replies });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer respuestas rapidas";
    return NextResponse.json({ replies: [], error: message }, { status: 500 });
  }
}

interface PostBody {
  store?: string;
  title?: string;
  body?: string;
  vendedora_id?: number;
}

// POST /api/quick-replies — crea una respuesta rapida para la tienda.
export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as PostBody | null;
  const store = getRequiredStoreFromBody(payload);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const title = String(payload?.title ?? "").trim();
  const body = String(payload?.body ?? "").trim();
  if (!title || !body) {
    return NextResponse.json({ error: "Nombre y mensaje son obligatorios." }, { status: 400 });
  }
  if (title.length > QUICK_REPLY_MAX_TITLE) {
    return NextResponse.json(
      { error: `El nombre supera ${QUICK_REPLY_MAX_TITLE} caracteres.` },
      { status: 400 }
    );
  }
  if (body.length > QUICK_REPLY_MAX_BODY) {
    return NextResponse.json(
      { error: `El mensaje supera ${QUICK_REPLY_MAX_BODY} caracteres.` },
      { status: 400 }
    );
  }
  const vendedoraId = Number(payload?.vendedora_id);
  try {
    const reply = await createQuickReply({
      storeId: store.id,
      title,
      body,
      createdBy: Number.isFinite(vendedoraId) && vendedoraId > 0 ? vendedoraId : null,
    });
    return NextResponse.json({ reply }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al crear la respuesta rapida";
    const conflict = message.includes("Ya existe");
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}
