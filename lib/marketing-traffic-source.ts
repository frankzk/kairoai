// Fuente del tráfico de cada pedido para el CPA por producto (27/11/2026):
// Meta, TikTok, Google, otra fuente, orgánico / directo o sin dato.
//
// Sale de lo que Marketing ya lee de cada pedido, sin consultas nuevas:
// la UTM web del pedido (`readIcomflyAdOrigin`, con el click id como
// respaldo) o el anuncio de WhatsApp que abrió el chat (siempre Meta), y si
// no hay ninguno, el origen del pedido dentro de su canal. Las reglas, en
// orden:
//
// 1. Con anuncio o UTM: su plataforma (Meta, TikTok, Google; cualquier otra
//    UTM o referencia es "Otra fuente"). Vale también para los pedidos que
//    creó el equipo (Leads, asesora) si el pedido la trae.
// 2. Sin anuncio ni UTM: la página web (formulario, carrito recuperado,
//    Shopify) y el bot cuyo chat no vino de un anuncio son "Orgánico /
//    directo"; el bot sin revisar y los pedidos que creó el equipo (Leads en
//    Kairo, asesoras, MANUAL sin creador) o de origen no claro quedan "Sin
//    dato de fuente": no guardan de dónde llegó el cliente.
// 3. Datos del mismo pedido que nombran plataformas distintas: "Sin dato".
//
// Como el origen, la fuente solo muestra pedidos, unidades y %: el gasto se
// separa por canal, nunca por fuente.
//
// Puro y sin dependencias de servidor (lo usa el Tablero en el navegador).
// Se prueba en tests/marketing-traffic-source.test.ts.
import type { IcomflyAdOrigin } from "./icomfly-ad-origin";
import type { SaleOrigin } from "./marketing-channel-cpa";

export type TrafficSource =
  | "meta"
  | "tiktok"
  | "google"
  | "otra"
  | "organico"
  | "sin_dato";

/** Display order. */
export const TRAFFIC_SOURCES: readonly TrafficSource[] = [
  "meta",
  "tiktok",
  "google",
  "otra",
  "organico",
  "sin_dato",
];

export const TRAFFIC_SOURCE_LABEL: Record<TrafficSource, string> = {
  meta: "Meta (Facebook / Instagram)",
  tiktok: "TikTok",
  google: "Google",
  otra: "Otra fuente",
  organico: "Orgánico / directo",
  sin_dato: "Sin dato de fuente",
};

export const TRAFFIC_SOURCE_HINT: Record<TrafficSource, string> = {
  meta: "UTM o click id de Meta en la página web, o anuncio de Meta que abrió el chat de WhatsApp",
  tiktok: "UTM o click id de TikTok en la página web",
  google: "UTM o click id de Google en la página web",
  otra: "Una UTM o referencia que no es Meta, TikTok ni Google (por ejemplo chatgpt.com)",
  organico:
    "Página web sin UTM ni click id, o chat del bot que no vino de un anuncio",
  sin_dato:
    "Pedidos creados por el equipo (Leads en Kairo, asesoras, MANUAL) y bot sin revisar: no guardan de dónde llegó el cliente",
};

/** Sources listed even with 0 orders; the rest only when they have orders. */
const SHOWN_EMPTY = new Set<TrafficSource>(["meta", "tiktok", "organico"]);
export const sourceShownEmpty = (source: TrafficSource) =>
  SHOWN_EMPTY.has(source);

export const isTrafficSource = (value: unknown): value is TrafficSource =>
  typeof value === "string" &&
  (TRAFFIC_SOURCES as readonly string[]).includes(value);

/** Origins without ad or UTM that are organic: the web and the bot without ad. */
const ORGANIC = new Set<SaleOrigin>([
  "formulario",
  "carrito",
  "shopify",
  "bot_organico",
]);

/**
 * Traffic source of one order. `ad` = the ad origin Marketing resolved for
 * it (web UTM, else the WhatsApp ad of the chat), "ambiguous" when its rows
 * name different platforms, null/undefined without any.
 */
export function orderTrafficSource(
  origin: SaleOrigin,
  ad: Pick<IcomflyAdOrigin, "platform"> | "ambiguous" | null | undefined,
): TrafficSource {
  if (ad === "ambiguous") return "sin_dato";
  if (ad) {
    const platform = ad.platform;
    return platform === "meta" || platform === "tiktok" || platform === "google"
      ? platform
      : "otra";
  }
  if (ORGANIC.has(origin)) return "organico";
  // iComfly said the chat came from an ad (always a Meta Click-to-WhatsApp).
  if (origin === "bot_anuncio") return "meta";
  return "sin_dato";
}

/**
 * The ad origins of the rows of one order, as one: its platform when the
 * rows agree (ignoring "other" and unknown platforms), "ambiguous" when they
 * name two, an "other" origin when only those exist, null without any.
 */
export function mergeTrafficAds(
  origins: Array<Pick<IcomflyAdOrigin, "platform"> | null | undefined>,
): Pick<IcomflyAdOrigin, "platform"> | "ambiguous" | null {
  const found = origins.filter(
    (o): o is Pick<IcomflyAdOrigin, "platform"> => o != null,
  );
  if (!found.length) return null;
  const platforms = Array.from(
    new Set(
      found
        .map((o) => o.platform)
        .filter((p) => p === "meta" || p === "tiktok" || p === "google"),
    ),
  );
  if (platforms.length > 1) return "ambiguous";
  return { platform: platforms[0] ?? "other" };
}
