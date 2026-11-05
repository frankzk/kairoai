// Acceso a las rutas de Marketing (Mireva Costa Rica): permiso "marketing",
// tienda mireva-cr asignada y store=mireva-cr en la consulta. Escribir exige
// además no ser "solo_lectura".
import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "./identidad";
import { getRequiredStoreFromSearchParams } from "./stores";
import { metaAccountIds } from "./marketing-sources";
import { anunciantesTiktok } from "./tiktok-diario";

export const MARKETING_NO_STORE = { "Cache-Control": "private, no-store" };

export const marketingReply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: MARKETING_NO_STORE });

export function marketingAccess(req: NextRequest) {
  const actor = identidadActual();
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  return actor?.permisos.includes("marketing") &&
    actor.tiendas.includes("mireva-cr") &&
    store?.code === "mireva-cr"
    ? { actor, store }
    : null;
}

export const canEditMarketing = (
  allowed: ReturnType<typeof marketingAccess>,
): allowed is NonNullable<ReturnType<typeof marketingAccess>> =>
  Boolean(allowed) &&
  !(allowed!.actor.permisos as string[]).includes("solo_lectura");

/** `id:nombre`, the audit format of the existing Marketing tables. */
export const marketingAuthor = (
  actor: NonNullable<ReturnType<typeof marketingAccess>>["actor"],
) => `${actor.id}:${actor.nombre}`.slice(0, 200);

/** Reads a JSON object body with a size limit; null when invalid. */
export async function readJsonBody(
  req: NextRequest,
  maxChars: number,
): Promise<{ body: Record<string, unknown> } | { error: NextResponse }> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { error: marketingReply({ error: "Solicitud inválida." }, 400) };
  }
  if (raw.length > maxChars)
    return {
      error: marketingReply({ error: "Solicitud demasiado grande." }, 413),
    };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return { body: parsed as Record<string, unknown> };
  } catch {
    return { error: marketingReply({ error: "Solicitud inválida." }, 400) };
  }
}

/** Ad accounts of Costa Rica a write may name (Meta env list; TikTok env id or advertisers seen from Make). */
export async function marketingAccountIds(
  platform: unknown,
  storeId: number,
): Promise<string[]> {
  if (platform === "meta") {
    try {
      return metaAccountIds(process.env);
    } catch {
      return [];
    }
  }
  if (platform === "tiktok")
    return [
      process.env.TIKTOK_CR_ADVERTISER_ID,
      ...(await anunciantesTiktok(storeId).catch(() => [])),
    ].filter((id): id is string => Boolean(id));
  return [];
}
