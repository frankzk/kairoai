// "Sincronizar ahora" de ShipHero (solo quien edita Marketing). Guarda la foto
// de hoy del inventario. Espera 10 minutos entre corridas: los créditos de la
// API de ShipHero se comparten con las demás integraciones de Boxful. Un
// cambio de cliente/almacén o una conexión nueva borran la espera.
import { NextRequest } from "next/server";
import {
  canEditMarketing,
  marketingAccess,
  marketingAuthor,
  marketingReply,
} from "@/lib/marketing-access";
import { marketingCatalogLoader } from "@/lib/marketing-catalog-loader";
import {
  SHIPHERO_SYNC_BUDGET_MS,
  ShipHeroStorageError,
  readConnectionRow,
  syncCooldownLeftMs,
  syncShipHeroInventory,
} from "@/lib/shiphero-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const allowed = marketingAccess(req);
  if (!canEditMarketing(allowed))
    return marketingReply(
      {
        error: allowed
          ? "No tienes permiso para modificar Marketing."
          : "No tienes acceso a Marketing de Costa Rica.",
      },
      403,
    );
  try {
    const row = await readConnectionRow(allowed.store.id);
    const waitMs = syncCooldownLeftMs(row, start);
    if (waitMs > 0) {
      const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
      return marketingReply(
        {
          error: `Ya se sincronizó hace poco. Prueba en ${minutes} min.`,
          retryInMinutes: minutes,
        },
        429,
      );
    }
  } catch (error) {
    return marketingReply(
      {
        error:
          error instanceof ShipHeroStorageError
            ? error.message
            : "No se pudo leer la conexión con ShipHero.",
      },
      503,
    );
  }
  const result = await syncShipHeroInventory(allowed.store.id, {
    by: marketingAuthor(allowed.actor),
    deadline: start + SHIPHERO_SYNC_BUDGET_MS,
    catalog: marketingCatalogLoader(allowed.store),
  });
  if (!result.ok)
    return marketingReply(
      { error: result.error ?? "No se pudo sincronizar ShipHero.", result },
      502,
    );
  return marketingReply({ status: "ok", result });
}
