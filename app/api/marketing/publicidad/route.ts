// Marketing › Publicidad (25/11/2026): la tabla del administrador de anuncios
// (campañas, conjuntos de anuncios y anuncios con sus métricas) para un rango.
// SOLO LECTURA: esta ruta solo tiene GET y hacia Meta solo hace GET.
//
//   GET ?store=mireva-cr|mireva-hn&from=YYYY-MM-DD&to=YYYY-MM-DD&level=campaign|adset|ad
//       [&platform=meta|tiktok][&account=<id>][&campaign=<id>][&adset=<id>][&refresh=1]
//
// Meta se lee en vivo (lib/marketing-publicidad-server.ts, con caché de 60 s
// que `refresh=1` salta); TikTok sale de lo que Make guarda en la base
// (lib/marketing-publicidad-tiktok.ts). La respuesta nunca lleva el token ni
// el mensaje de error del proveedor.
import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { isMarketingStore, marketingStoreInfo } from "@/lib/marketing-stores";
import { periodFromParams } from "@/lib/marketing-dates";
import {
  PUBLICIDAD_LEVELS,
  type PublicidadLevel,
  type PublicidadPayload,
} from "@/lib/marketing-publicidad";
import { getPublicidadMeta } from "@/lib/marketing-publicidad-server";
import { getPublicidadTiktok } from "@/lib/marketing-publicidad-tiktok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store || !isMarketingStore(store.code))
    return reply(
      { error: "store=mireva-cr o mireva-hn requerido y autorizado." },
      400,
    );
  const period = periodFromParams(params);
  if (!period)
    return reply({ error: "Indica un rango válido de hasta 93 días." }, 400);
  const level = params.get("level") || "campaign";
  if (!(PUBLICIDAD_LEVELS as readonly string[]).includes(level))
    return reply({ error: "level debe ser campaign, adset o ad." }, 400);
  const platform = params.get("platform") || "meta";
  if (platform !== "meta" && platform !== "tiktok")
    return reply({ error: "platform debe ser meta o tiktok." }, 400);
  // Los ids van dentro de la consulta a Meta: solo dígitos.
  const id = (name: string) => {
    const value = (params.get(name) || "").trim().replace(/^act_/, "");
    return value === "" ? undefined : /^\d{1,30}$/.test(value) ? value : null;
  };
  const account = id("account"),
    campaign = id("campaign"),
    adset = id("adset");
  if (account === null || campaign === null || adset === null)
    return reply(
      { error: "account, campaign y adset deben ser ids numéricos." },
      400,
    );
  const query = {
    level: level as PublicidadLevel,
    from: period.from,
    to: period.to,
    account,
    campaign,
    adset,
  };
  const info = marketingStoreInfo(store.code);
  if (platform === "tiktok" && !info.tiktok)
    // Sin TikTok en esta tienda: el estado de "no conectado", sin error.
    return reply({
      platform: "tiktok",
      status: "pending",
      message: `TikTok Ads no está conectado para ${info.country}.`,
      level: query.level,
      from: query.from,
      to: query.to,
      generatedAt: new Date().toISOString(),
      accounts: [],
      rows: [],
      unavailable: [],
    } satisfies PublicidadPayload);
  if (platform === "tiktok") {
    try {
      return reply(await getPublicidadTiktok(store.id, query));
    } catch {
      return reply(
        {
          error:
            "No se pudo leer lo que Make guardó de TikTok. Vuelve a intentarlo.",
        },
        502,
      );
    }
  }
  return reply(
    await getPublicidadMeta({
      ...query,
      store: store.code,
      refresh: params.get("refresh") === "1",
    }),
  );
}
