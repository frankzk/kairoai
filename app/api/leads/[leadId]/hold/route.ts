import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "@/lib/identidad";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import { canTakeOverHold, holdActive } from "@/lib/lead-holds";
import { acquireLeadHold, readLeadHold, releaseLeadHold } from "@/lib/lead-holds-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const headers = { "Cache-Control": "private, no-store" };

function leadIdOf(raw: string): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * GET ?store=: quién tiene el lead ahora, sin tomarlo. El aviso de "lead
 * ocupado" y la ficha lo consultan UNA vez cuando vence la reserva (no hay
 * sondeo). status: free | mine | other | unavailable.
 */
export async function GET(req: NextRequest, ctx: { params: { leadId: string } }) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "Tienda no permitida." }, { status: 400, headers });
  const leadId = leadIdOf(ctx.params.leadId);
  if (!leadId) return NextResponse.json({ error: "leadId invalido" }, { status: 400, headers });
  const now = Date.now();
  const hold = await readLeadHold(leadId);
  const base = { server_now: new Date(now).toISOString(), can_take_over: canTakeOverHold(yo.permisos) };
  if (hold === "unavailable") return NextResponse.json({ status: "unavailable", ...base }, { headers });
  if (!hold || !holdActive(hold, now)) return NextResponse.json({ status: "free", ...base }, { headers });
  return NextResponse.json(
    { status: hold.holder_user_id === yo.id ? "mine" : "other", hold, ...base },
    { headers }
  );
}

interface Body {
  store?: string;
  /** "acquire" (por defecto) o "release". El beacon de pagehide solo puede hacer POST. */
  action?: string;
  /** "Abrir de todos modos": solo cuenta con permiso de supervisión. */
  takeover?: boolean;
}

/**
 * POST { store, action?, takeover? }
 *  - acquire: toma la reserva (o confirma la propia, sin alargarla).
 *    status: held | blocked | unavailable (la base no respondió o falta la
 *    migración: el navegador abre el lead como siempre).
 *  - release: suelta la reserva de quien llama (nunca la de otra persona).
 */
export async function POST(req: NextRequest, ctx: { params: { leadId: string } }) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  // Mismo origen (incluye el beacon de pagehide): sin escrituras cruzadas.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) return NextResponse.json({ error: "Tienda no permitida." }, { status: 400, headers });
  const leadId = leadIdOf(ctx.params.leadId);
  if (!leadId) return NextResponse.json({ error: "leadId invalido" }, { status: 400, headers });

  if (body?.action === "release") {
    await releaseLeadHold(leadId, yo.id);
    return new NextResponse(null, { status: 204, headers });
  }

  const result = await acquireLeadHold({ leadId, storeId: store.id, yo, takeover: body?.takeover === true });
  if (result.status === "not_found") {
    return NextResponse.json({ error: "lead no encontrado" }, { status: 404, headers });
  }
  return NextResponse.json(result, { headers });
}
