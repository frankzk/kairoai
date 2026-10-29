import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { identidadActual } from "@/lib/identidad";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { readCharlieSettings } from "@/lib/marketing-charlie-settings";
import { metaAccountIds } from "@/lib/marketing-sources";
import { dateTime, marketingDate } from "@/lib/marketing-dates";
import { getMarketingData } from "@/lib/marketing-data";
import { presetPeriod } from "@/lib/marketing-dates";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
function access(req: NextRequest) {
  const actor = identidadActual(),
    store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  return actor?.permisos.includes("marketing") &&
    actor.tiendas.includes("mireva-cr") &&
    store?.code === "mireva-cr"
    ? { actor, store }
    : null;
}
export async function GET(req: NextRequest) {
  const allowed = access(req);
  if (!allowed)
    return reply({ error: "Marketing y Mireva Costa Rica requeridos." }, 403);
  try {
    return reply(await readCharlieSettings(allowed.store.id));
  } catch {
    return reply({ error: "No se pudo cargar la configuración Charlie." }, 503);
  }
}
export async function PATCH(req: NextRequest) {
  const allowed = access(req);
  if (!allowed || (allowed.actor.permisos as string[]).includes("solo_lectura"))
    return reply(
      { error: "No tienes permiso para cambiar esta configuración." },
      403,
    );
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 16000)
      return reply({ error: "Solicitud demasiado grande." }, 413);
    body = JSON.parse(raw);
    if (!body || Array.isArray(body) || typeof body !== "object")
      throw new Error();
  } catch {
    return reply({ error: "Solicitud inválida." }, 400);
  }
  const audit = {
    store_id: allowed.store.id,
    updated_by: `${allowed.actor.id}:${allowed.actor.nombre}`.slice(0, 200),
    updated_at: new Date().toISOString(),
  };
  try {
    if (body.kind === "config") {
      const rate = body.crc_per_usd,
        date = body.rate_date,
        heroes = body.hero_product_keys;
      if (
        !(
          (rate === null && date === null) ||
          (typeof rate === "number" &&
            Number.isFinite(rate) &&
            rate > 0 &&
            rate <= 100000 &&
            typeof date === "string" &&
            Number.isFinite(dateTime(date)) &&
            date <= marketingDate())
        ) ||
        !Array.isArray(heroes) ||
        heroes.length > 100 ||
        heroes.some((key) => typeof key !== "string" || key.length > 300)
      )
        return reply(
          { error: "Revisa la tasa, la fecha y los productos de la oferta." },
          400,
        );
      if (heroes.length) {
        const snapshot = await getMarketingData(
          allowed.store,
          presetPeriod("today"),
        );
        if (
          heroes.some(
            (key) => !snapshot.catalog.some((product) => product.key === key),
          )
        )
          return reply(
            {
              error:
                "La oferta contiene un producto fuera del catálogo de Costa Rica.",
            },
            400,
          );
      }
      const result = await getDB()
        .from("marketing_charlie_config")
        .upsert(
          {
            ...audit,
            crc_per_usd: rate,
            rate_date: date,
            hero_product_keys: Array.from(new Set(heroes)),
          },
          { onConflict: "store_id" },
        );
      if (result.error) throw new Error();
    } else if (body.kind === "role") {
      const account = body.account_id,
        adset = body.adset_id,
        role = body.role;
      if (
        typeof account !== "string" ||
        !metaAccountIds(process.env).includes(account) ||
        typeof adset !== "string" ||
        !/^\d{1,40}$/.test(adset) ||
        !["auto", "control", "testing", "other"].includes(String(role))
      )
        return reply({ error: "Cuenta, conjunto o rol inválido." }, 400);
      const url = new URL(
        `https://graph.facebook.com/${process.env.META_CR_GRAPH_VERSION}/${adset}`,
      );
      url.searchParams.set("fields", "id,account_id");
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.META_CR_ACCESS_TOKEN}`,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      const record = await response.json();
      if (record.id !== adset || record.account_id !== account)
        return reply({ error: "El conjunto no pertenece a esa cuenta." }, 400);
      const result =
        role === "auto"
          ? await getDB()
              .from("marketing_adset_roles")
              .delete()
              .eq("store_id", allowed.store.id)
              .eq("account_id", account)
              .eq("adset_id", adset)
          : await getDB()
              .from("marketing_adset_roles")
              .upsert(
                { ...audit, account_id: account, adset_id: adset, role },
                { onConflict: "store_id,account_id,adset_id" },
              );
      if (result.error) throw new Error();
    } else return reply({ error: "Tipo de ajuste inválido." }, 400);
    return reply({ saved: true });
  } catch {
    return reply(
      { error: "No se pudo guardar. El ajuste anterior se conserva." },
      503,
    );
  }
}
