// TikTok en la pestaña "Publicidad" de Marketing (25/11/2026). Solo servidor.
//
// Kairo no tiene acceso a la API de TikTok (la app de desarrollador fue
// rechazada): lo único que hay es lo que el escenario de Make guarda cada día.
//   - Campañas: tiktok_ads_diario (lib/tiktok-diario.ts) — gasto, impresiones,
//     clics y conversiones por campaña y día. Es la misma fuente del gasto de
//     TikTok en el resto de Marketing.
//   - Grupos de anuncios y anuncios: tiktok_anuncios_diario
//     (lib/tiktok-anuncios.ts) — el reporte por anuncio de la Matriz 4Pi, con
//     compras (Complete Payment) y su valor.
// No hay estado de entrega, presupuesto, leads ni "resultados": esas columnas
// no se ofrecen para TikTok (no se inventan). La respuesta dice hasta qué día
// llegó cada reporte para que la pantalla lo muestre.
import { getDB } from "@/lib/db";
import {
  tiktokAdRows,
  tiktokCampaignRows,
  type PublicidadLevel,
  type PublicidadPayload,
  type PublicidadRow,
} from "@/lib/marketing-publicidad";
import {
  leerCuentasCharlieTiktok,
  TABLA_ANUNCIOS,
} from "@/lib/tiktok-anuncios";
import { leerCuentasTiktok, TABLA } from "@/lib/tiktok-diario";

/** Último día guardado de una tabla de TikTok para la tienda, o null si Make no ha mandado nada. */
async function ultimoDia(
  tabla: string,
  storeId: number,
): Promise<string | null> {
  const { data, error } = await getDB()
    .from(tabla)
    .select("fecha")
    .eq("store_id", storeId)
    .order("fecha", { ascending: false })
    .limit(1);
  if (error) throw new Error(`ultimoDia ${tabla}: ${error.message}`);
  const fecha = (data as Array<{ fecha: string | null }> | null)?.[0]?.fecha;
  return fecha ? String(fecha).slice(0, 10) : null;
}

export async function getPublicidadTiktok(
  storeId: number,
  query: {
    level: PublicidadLevel;
    from: string;
    to: string;
    account?: string;
    campaign?: string;
    adset?: string;
  },
): Promise<PublicidadPayload> {
  const [campaignsUntil, adsUntil, rows] = await Promise.all([
    ultimoDia(TABLA, storeId).catch(() => null),
    ultimoDia(TABLA_ANUNCIOS, storeId).catch(() => null),
    query.level === "campaign"
      ? leerCuentasTiktok(storeId, query.from, query.to).then(
          tiktokCampaignRows,
        )
      : leerCuentasCharlieTiktok(storeId, query.from, query.to).then(
          (accounts) =>
            tiktokAdRows(accounts, query.level as "adset" | "ad", {
              campaign: query.campaign,
              adset: query.level === "ad" ? query.adset : undefined,
            }),
        ),
  ]);
  const listed: PublicidadRow[] = rows.filter(
    (row) =>
      (!query.account || row.accountId === query.account) &&
      (query.level !== "campaign" ||
        !query.campaign ||
        row.id === query.campaign),
  );
  const accounts = new Map(
    listed.map((row) => [
      row.accountId,
      {
        accountId: row.accountId,
        accountName: row.accountName || row.accountId,
        currency: row.currency,
        // TikTok no manda estado ni presupuesto: no es una lectura fallida.
        entities: "ok" as const,
        results: "ok" as const,
      },
    ]),
  );
  return {
    platform: "tiktok",
    status: "ready",
    level: query.level,
    from: query.from,
    to: query.to,
    generatedAt: new Date().toISOString(),
    accounts: Array.from(accounts.values()),
    rows: listed,
    unavailable: [],
    tiktok: { campaignsUntil, adsUntil },
  };
}
