// Acceso a las rutas de Marketing (Mireva Costa Rica y Mireva Honduras):
// permiso "marketing", la tienda pedida asignada a la persona y store=<tienda>
// en la consulta. Escribir exige además no ser "solo_lectura". Las reglas son
// las mismas para las dos tiendas (lib/marketing-stores.ts).
import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "./identidad";
import { getRequiredStoreFromSearchParams, type FinanceStoreConfig } from "./stores";
import { metaAccountIds } from "./marketing-sources";
import { anunciantesTiktok } from "./tiktok-diario";
import { isMarketingStore, marketingStoreInfo } from "./marketing-stores";
import type { Identidad } from "./auth";
import { getFinanceStoreById } from "./store-config";

export const MARKETING_NO_STORE = { "Cache-Control": "private, no-store" };

export const marketingReply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: MARKETING_NO_STORE });

/** 403 de las rutas de Marketing sin permiso o sin la tienda. */
export const MARKETING_NO_ACCESS =
  "Se requiere Marketing y acceso a la tienda elegida.";

/**
 * Pure: who may use Marketing for `store` — the "marketing" permission, the
 * store among the person's `tiendas` and a store that has Marketing.
 */
export function marketingAllowed(
  actor: Pick<Identidad, "permisos" | "tiendas"> | null | undefined,
  store: Pick<FinanceStoreConfig, "code"> | null | undefined,
): boolean {
  return Boolean(
    actor?.permisos.includes("marketing") &&
      store &&
      isMarketingStore(store.code) &&
      actor.tiendas.includes(store.code),
  );
}

/**
 * Who calls and the store, or null. With `need = "shiphero"`, only a store
 * that has the ShipHero inventory (Costa Rica).
 */
export function marketingAccess(req: NextRequest, need?: "shiphero") {
  const actor = identidadActual();
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  return actor &&
    store &&
    marketingAllowed(actor, store) &&
    (need !== "shiphero" || marketingStoreInfo(store.code).shiphero)
    ? { actor, store }
    : null;
}

/**
 * The store of a Marketing read whose permission the middleware already
 * checked (store in the person's tiendas via getRequiredStoreFromSearchParams).
 * null = no store, not one of theirs, or one without Marketing.
 */
export function marketingStoreFromParams(
  params: URLSearchParams,
): FinanceStoreConfig | null {
  const store = getRequiredStoreFromSearchParams(params);
  return store && isMarketingStore(store.code) ? store : null;
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

/**
 * Ad accounts of the store a write may name: its own Meta env list; TikTok
 * (Costa Rica only) the env id or the advertisers seen from Make.
 */
export async function marketingAccountIds(
  platform: unknown,
  storeId: number,
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const code = getFinanceStoreById(storeId)?.code;
  if (!isMarketingStore(code)) return [];
  const info = marketingStoreInfo(code);
  if (platform === "meta") {
    try {
      return metaAccountIds(env, info.code);
    } catch {
      return [];
    }
  }
  if (platform === "tiktok" && info.tiktok)
    return [
      env.TIKTOK_CR_ADVERTISER_ID,
      ...(await anunciantesTiktok(storeId).catch(() => [])),
    ].filter((id): id is string => Boolean(id));
  return [];
}
