import { NextRequest, NextResponse } from "next/server";
import { buildShopifyMatchIndex, findShopifyOrderForRow } from "@/lib/order-matching";
import {
  loadShopifyOrdersForMatching,
  type MatchableShopifyOrder,
} from "@/lib/finance-matching";
import {
  listLogisticsRows,
  listSettlementRows,
  updateLogisticsImportMatchCounts,
  updateSettlementImportMatchCounts,
  upsertLogisticsRows,
  upsertSettlementRows,
  type LogisticsRow,
  type SettlementRow,
} from "@/lib/finance";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { toFriendlyErrorMessage } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPSERT_BATCH_SIZE = 500;

// Re-corre el matching pedido<->Boxful/liquidacion de los imports YA cargados
// contra la base persistida actual de shopify_orders, sin re-subir archivos.
// Resuelve el caso en que el Excel se importo antes de terminar el Sync Shopify:
// el matching se materializa al importar y no se recalcula cuando llegan pedidos
// nuevos, dejando filas con guia/estado pero "sin match".
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const store = getRequiredStoreFromBody(body);
    if (!store) {
      return NextResponse.json(
        { error: "store requerido: usa mireva-cr o mireva-hn" },
        { status: 400 }
      );
    }

    // Solo base persistida: el boton Sync Shopify mantiene shopify_orders; aqui
    // no llamamos a Shopify en vivo (seria lento y la base ya esta al dia).
    const shopifyOrders = await loadShopifyOrdersForMatching(null, store.id, {
      includeFreshShopify: false,
      fallbackToShopify: false,
    });
    const matchIndex = buildShopifyMatchIndex(shopifyOrders);

    const [logisticsRows, settlementRows] = await Promise.all([
      listLogisticsRows(undefined, store.id),
      listSettlementRows(undefined, store.id),
    ]);

    const logisticsByImport = new Map<number, ImportTally>();
    const updatedLogistics = logisticsRows.map((row) => {
      const shopify = findShopifyOrderForRow({ order_name: row.order_name }, matchIndex);
      tally(logisticsByImport, row.import_id, Boolean(shopify));
      return applyLogisticsMatch(row, shopify);
    });

    const settlementByImport = new Map<number, ImportTally>();
    const updatedSettlements = settlementRows.map((row) => {
      const shopify = findShopifyOrderForRow({ order_name: row.order_name }, matchIndex);
      tally(settlementByImport, row.import_id, Boolean(shopify));
      return applySettlementMatch(row, shopify);
    });

    await upsertInBatches(updatedLogistics, upsertLogisticsRows);
    await upsertInBatches(updatedSettlements, upsertSettlementRows);

    await Promise.all([
      ...Array.from(logisticsByImport.entries()).map(([importId, t]) =>
        updateLogisticsImportMatchCounts(importId, store.id, t.matched, t.total - t.matched)
      ),
      ...Array.from(settlementByImport.entries()).map(([importId, t]) =>
        updateSettlementImportMatchCounts(importId, store.id, t.matched, t.total - t.matched)
      ),
    ]);

    return NextResponse.json({
      ok: true,
      store: store.code,
      shopify_base: shopifyOrders.length,
      logistics: summarize(logisticsRows.length, logisticsByImport),
      settlements: summarize(settlementRows.length, settlementByImport),
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al re-emparejar imports");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface ImportTally {
  matched: number;
  total: number;
}

function tally(map: Map<number, ImportTally>, importId: number, matched: boolean): void {
  const current = map.get(importId) ?? { matched: 0, total: 0 };
  current.total += 1;
  if (matched) current.matched += 1;
  map.set(importId, current);
}

function summarize(total: number, byImport: Map<number, ImportTally>) {
  const matched = Array.from(byImport.values()).reduce((acc, entry) => acc + entry.matched, 0);
  return { total, matched, unmatched: total - matched };
}

// El internal_status no se recalcula: depende del estado de Boxful/liquidacion
// (texto del Excel), no del pedido de Shopify, asi que es invariante al re-match.
function applyLogisticsMatch(row: LogisticsRow, shopify?: MatchableShopifyOrder): LogisticsRow {
  if (!shopify) {
    return {
      ...row,
      match_status: "unmatched",
      shopify_order_id: "",
      shopify_order_name: "",
      shopify_order_number: null,
      shopify_financial_status: "",
      shopify_fulfillment_status: "",
      shopify_cancelled_at: null,
      shopify_total: 0,
      shopify_created_at: null,
    };
  }
  return {
    ...row,
    match_status: "matched",
    shopify_order_id: String(shopify.id),
    shopify_order_name: shopify.name,
    shopify_order_number: shopify.order_number ?? null,
    shopify_financial_status: shopify.financial_status ?? "",
    shopify_fulfillment_status: shopify.fulfillment_status ?? "",
    shopify_cancelled_at: shopify.cancelled_at ?? null,
    shopify_total: Number(shopify.total_price ?? 0),
    shopify_created_at: shopify.created_at || null,
  };
}

function applySettlementMatch(row: SettlementRow, shopify?: MatchableShopifyOrder): SettlementRow {
  if (!shopify) {
    return {
      ...row,
      match_status: "unmatched",
      shopify_order_id: "",
      shopify_order_name: "",
      shopify_financial_status: "",
      shopify_fulfillment_status: "",
      shopify_total: 0,
      shopify_created_at: null,
      order_items: [],
    };
  }
  return {
    ...row,
    match_status: "matched",
    shopify_order_id: String(shopify.id),
    shopify_order_name: shopify.name,
    shopify_financial_status: shopify.financial_status ?? "",
    shopify_fulfillment_status: shopify.fulfillment_status ?? "",
    shopify_total: Number(shopify.total_price ?? 0),
    shopify_created_at: shopify.created_at || null,
    order_items: (shopify.line_items ?? []).map((item) => ({
      sku: String(item.sku ?? "").toLowerCase(),
      title: String(item.title ?? ""),
      quantity: Number(item.quantity ?? 0),
      price: Number(item.price ?? 0),
    })),
  };
}

async function upsertInBatches<T>(rows: T[], upsert: (batch: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    await upsert(rows.slice(i, i + UPSERT_BATCH_SIZE));
  }
}
