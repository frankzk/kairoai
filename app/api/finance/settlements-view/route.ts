import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import type { DoubleSettlementAnomaly } from "@/lib/finance-orders";
import type { LogisticsRow, SettlementRow } from "@/lib/finance-types";
import { getOrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vista del tab Liquidaciones server-side (Carril 2 — ultimo tab). Devuelve lo que
// la UI necesita ya calculado desde el dataset cacheado: las filas de liquidacion
// enriquecidas con Shopify (matchedSettlementRows), las alertas "entregados sin
// liquidar" y las anomalias de doble liquidacion. Asi el navegador deja de cargar
// el snapshot pesado (~11k pedidos Shopify + logistica completa).
//
// imports/, shopifyCoverage y el flujo de import/delete siguen en sus endpoints
// originales (/api/finance/settlements); esta ruta solo cubre lo que antes se
// derivaba del snapshot en memoria.
const SETTLEMENTS_VIEW_TTL_MS = 30_000;
type SettlementsViewPayload = {
  rows: SettlementRow[];
  liquidationAlertRows: LogisticsRow[];
  doubleSettlementAnomalies: DoubleSettlementAnomaly[];
};
const settlementsViewCache = new Map<string, { at: number; data: SettlementsViewPayload }>();

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }

  try {
    const cached = settlementsViewCache.get(store.code);
    if (cached && Date.now() - cached.at < SETTLEMENTS_VIEW_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    // El dataset ya calcula todo esto (mismas operaciones que los useMemo de
    // page.tsx): matchedSettlementRows = liquidaciones enriquecidas con Shopify;
    // liquidationAlertRows y doubleSettlementAnomalies pre-computados con la misma
    // semantica que el cliente.
    const { matchedSettlementRows, liquidationAlertRows, doubleSettlementAnomalies } =
      await getOrdersDataset(store);

    const data: SettlementsViewPayload = {
      rows: matchedSettlementRows,
      liquidationAlertRows,
      doubleSettlementAnomalies,
    };
    settlementsViewCache.set(store.code, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al cargar la vista de liquidaciones");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
