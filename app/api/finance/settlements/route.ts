import { NextRequest, NextResponse } from "next/server";
import { readWorkbook } from "@/lib/xlsx";
import {
  inferEarliestCreatedOn,
  parseSettlementWorkbook,
  type ParsedSettlementRow,
} from "@/lib/finance-import";
import { buildShopifyMatchIndex, findShopifyOrderForRow } from "@/lib/order-matching";
import {
  loadShopifyOrdersForMatching,
  type MatchableShopifyOrder as ShopifySettlementOrder,
} from "@/lib/finance-matching";
import {
  createSettlementImport,
  deleteSettlementImport,
  insertSettlementRows,
  listSettlementImports,
  listSettlementRows,
  upsertBoxfulFileControl,
  type SettlementOrderItem,
  type SettlementRow,
} from "@/lib/finance";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreConfig, getRequiredStoreFromSearchParams } from "@/lib/stores";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

const INSERT_BATCH_SIZE = 250;
const INSERT_CONCURRENCY = 4;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  try {
    const importId = Number(req.nextUrl.searchParams.get("import_id"));
    const [imports, rows] = await Promise.all([
      listSettlementImports(store.id),
      listSettlementRows(importId || undefined, store.id),
    ]);
    return NextResponse.json({ imports, rows });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al leer liquidaciones");
    return NextResponse.json({ imports: [], rows: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const store = getRequiredStoreConfig(form.get("store"));
    if (!store) return missingStoreResponse();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
    }

    const periodStart = nullableDate(String(form.get("period_start") ?? ""));
    const periodEnd = nullableDate(String(form.get("period_end") ?? ""));
    const periodLabel =
      String(form.get("period_label") ?? "").trim() || (periodEnd ? `Corte ${periodEnd}` : "");

    const workbook = readWorkbook(await file.arrayBuffer());
    const { rows: settlementRows, consolidated } = parseSettlementWorkbook(workbook);
    if (!settlementRows.length) {
      return NextResponse.json({ error: "No se encontraron filas en la hoja Envios" }, { status: 400 });
    }

    const shopifyOrders = await loadShopifyOrdersForMatching(
      periodStart ?? inferEarliestCreatedOn(settlementRows),
      store.id
    );
    const matchIndex = buildShopifyMatchIndex(shopifyOrders);

    const statusSummary: Record<string, { count: number; amount_to_liquidate: number }> = {};
    let matchedRows = 0;

    const pendingRows = settlementRows.map((row) => {
      const shopify = findShopifyOrderForRow({ order_name: row.order_name }, matchIndex);
      if (shopify) matchedRows++;

      const status = statusSummary[row.settlement_status] ?? {
        count: 0,
        amount_to_liquidate: 0,
      };
      status.count += 1;
      status.amount_to_liquidate = roundMoney(status.amount_to_liquidate + row.amount_to_liquidate);
      statusSummary[row.settlement_status] = status;

      return { row, shopify };
    });

    const settlementImport = await createSettlementImport(
      {
        file_name: file.name,
        period_label: periodLabel,
        period_start: periodStart,
        period_end: periodEnd,
        total_rows: settlementRows.length,
        matched_rows: matchedRows,
        unmatched_rows: settlementRows.length - matchedRows,
        total_collected: consolidated.total_collected || sum(settlementRows.map((r) => r.cod_amount)),
        total_to_liquidate:
          consolidated.total_to_liquidate || sum(settlementRows.map((r) => r.amount_to_liquidate)),
        status_summary: statusSummary,
      },
      store.id
    );
    try {
      await upsertBoxfulFileControl(
        {
          file_name: file.name,
          file_type: "liquidacion",
          cutoff_date: periodEnd,
          status: "importado",
          import_id: settlementImport.id,
          imported_at: settlementImport.created_at,
        },
        store.id
      );
    } catch (fileControlError) {
      console.warn("[finance/settlements file control]", fileControlError);
    }

    const rowsToInsert = pendingRows.map(({ row, shopify }) =>
      buildSettlementRow(settlementImport.id, row, store.id, shopify)
    );

    // Si las filas no entran, el import se revierte: un archivo nunca debe
    // quedar registrado con 0 filas.
    try {
      const batches: (typeof rowsToInsert)[] = [];
      for (let i = 0; i < rowsToInsert.length; i += INSERT_BATCH_SIZE) {
        batches.push(rowsToInsert.slice(i, i + INSERT_BATCH_SIZE));
      }
      for (let i = 0; i < batches.length; i += INSERT_CONCURRENCY) {
        await Promise.all(batches.slice(i, i + INSERT_CONCURRENCY).map(insertSettlementRows));
      }
    } catch (insertError) {
      await deleteSettlementImport(settlementImport.id, store.id).catch(() => undefined);
      const detail = insertError instanceof Error ? insertError.message : String(insertError);
      throw new Error(`No se pudieron guardar las filas (import revertido): ${detail}`);
    }

    // El import muto settlement_rows: refresca la cache durable del dataset.
    // Defensivo: nunca debe romper el import si la cache falla.
    await refreshFinanceDatasetCache(store).catch((cacheErr) =>
      console.warn("[finance/settlements POST cache]", cacheErr)
    );

    return NextResponse.json({
      import: settlementImport,
      matched_rows: matchedRows,
      unmatched_rows: settlementRows.length - matchedRows,
      status_summary: statusSummary,
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al importar liquidacion");
    console.error("[finance/settlements POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteSettlementImport(id, store.id);
    await refreshFinanceDatasetCache(store).catch((cacheErr) =>
      console.warn("[finance/settlements DELETE cache]", cacheErr)
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al eliminar liquidacion");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function missingStoreResponse() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}

function buildSettlementRow(
  importId: number,
  row: ParsedSettlementRow,
  storeId: number,
  shopify?: ShopifySettlementOrder
): Omit<SettlementRow, "id" | "created_at"> {
  const orderItems: SettlementOrderItem[] = (shopify?.line_items ?? []).map((item) => ({
    sku: String(item.sku ?? "").toLowerCase(),
    title: String(item.title ?? ""),
    quantity: Number(item.quantity ?? 0),
    price: Number(item.price ?? 0),
  }));

  return {
    store_id: storeId,
    import_id: importId,
    guide_number: row.guide_number,
    order_name: row.order_name,
    store_order_number: row.store_order_number,
    customer_name: row.customer_name,
    first_name: row.first_name,
    last_name: row.last_name,
    customer_phone: row.customer_phone,
    created_on: row.created_on,
    courier: row.courier,
    service_type: row.service_type,
    cod_amount: row.cod_amount,
    cod_commission: row.cod_commission,
    card_commission: row.card_commission,
    delivery_cost: row.delivery_cost,
    pick_pack_cost: row.pick_pack_cost,
    packaging_cost: row.packaging_cost,
    amount_to_liquidate: row.amount_to_liquidate,
    settlement_status: row.settlement_status,
    match_status: shopify ? "matched" : "unmatched",
    internal_status: row.internal_status,
    shopify_order_id: shopify ? String(shopify.id) : "",
    shopify_order_name: shopify?.name ?? "",
    shopify_financial_status: shopify?.financial_status ?? "",
    shopify_fulfillment_status: shopify?.fulfillment_status ?? "",
    shopify_total: Number(shopify?.total_price ?? 0),
    // "" en timestamptz revienta el insert; solo fechas reales o null.
    shopify_created_at: shopify?.created_at || null,
    order_items: orderItems,
    raw_row: row.raw,
  };
}

function nullableDate(value: string): string | null {
  return value ? value : null;
}

function sum(values: number[]): number {
  return roundMoney(values.reduce((acc, value) => acc + Number(value || 0), 0));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
