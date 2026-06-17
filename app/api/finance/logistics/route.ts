import { NextRequest, NextResponse } from "next/server";
import { readWorkbook } from "@/lib/xlsx";
import {
  inferEarliestCreatedOn,
  parseLogisticsWorkbook,
  type ParsedLogisticsRow,
} from "@/lib/finance-import";
import { buildShopifyMatchIndex, findShopifyOrderForRow } from "@/lib/order-matching";
import {
  loadShopifyOrdersForMatching,
  type MatchableShopifyOrder as ShopifyOrder,
} from "@/lib/finance-matching";
import {
  createLogisticsImport,
  deleteLogisticsImport,
  insertLogisticsRows,
  listLogisticsImports,
  listLogisticsRows,
  listLogisticsRowsPage,
  upsertBoxfulFileControl,
  type InternalOrderStatus,
  type LogisticsRow,
} from "@/lib/finance";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreConfig, getRequiredStoreFromSearchParams } from "@/lib/stores";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

const INSERT_BATCH_SIZE = 500;
const INSERT_CONCURRENCY = 3;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  try {
    const rawImportId = Number(req.nextUrl.searchParams.get("import_id"));
    const importId = Number.isFinite(rawImportId) && rawImportId > 0 ? rawImportId : undefined;
    const includeRows = req.nextUrl.searchParams.get("include_rows") !== "0";
    const includeImports = req.nextUrl.searchParams.get("include_imports") !== "0";
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 1000);
    const offset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
    const slim = req.nextUrl.searchParams.get("slim") === "1";
    // all=1: trae TODAS las filas en una sola respuesta (el servidor pagina
    // internamente). Evita que el navegador encadene lotes que se cortan por
    // timeout y dejan fuera los pedidos viejos.
    const all = req.nextUrl.searchParams.get("all") === "1";
    const importsPromise = includeImports
      ? listLogisticsImports(store.id)
      : Promise.resolve([] as Awaited<ReturnType<typeof listLogisticsImports>>);
    if (!includeRows) {
      return NextResponse.json({
        imports: await importsPromise,
        rows: [],
        has_more: false,
        next_offset: null,
      });
    }
    if (all) {
      const [imports, rows] = await Promise.all([
        importsPromise,
        listLogisticsRows(importId, store.id, { slim }),
      ]);
      return NextResponse.json({ imports, rows, has_more: false, next_offset: null });
    }
    // imports + primera página de filas en paralelo (antes eran dos awaits en serie).
    const [imports, page] = await Promise.all([
      importsPromise,
      listLogisticsRowsPage({
        importId,
        storeId: store.id,
        limit,
        offset,
        slim,
      }),
    ]);
    return NextResponse.json({
      imports,
      rows: page.rows,
      has_more: page.hasMore,
      next_offset: page.nextOffset,
      limit,
      offset,
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al leer logistica");
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

    const periodLabel = String(form.get("period_label") ?? "");
    const periodStart = nullableDate(String(form.get("period_start") ?? ""));
    const periodEnd = nullableDate(String(form.get("period_end") ?? ""));

    const workbook = readWorkbook(await file.arrayBuffer());
    const { rows: boxfulRows } = parseLogisticsWorkbook(workbook);
    if (!boxfulRows.length) {
      return NextResponse.json({ error: "No se encontraron filas logisticas" }, { status: 400 });
    }

    const shopifyOrders = await loadShopifyOrdersForMatching(
      periodStart ?? inferEarliestCreatedOn(boxfulRows),
      store.id,
      {
        // La carga de Excel debe ser deterministica y rapida. El boton Sync
        // Shopify mantiene la base de pedidos; durante el import no llamamos a
        // Shopify porque un archivo grande puede pasar el timeout de Vercel.
        includeFreshShopify: false,
        fallbackToShopify: false,
      }
    );
    const matchIndex = buildShopifyMatchIndex(shopifyOrders);
    const statusSummary: Record<string, { count: number }> = {};
    let matchedRows = 0;

    const pendingRows = boxfulRows.map((row) => {
      const shopify = findShopifyOrderForRow({ order_name: row.order_name }, matchIndex);
      if (shopify) matchedRows++;

      statusSummary[row.boxful_status] = {
        count: (statusSummary[row.boxful_status]?.count ?? 0) + 1,
      };

      return { row, shopify };
    });

    const logisticsImport = await createLogisticsImport(
      {
        file_name: file.name,
        period_label: periodLabel,
        period_start: periodStart,
        period_end: periodEnd,
        total_rows: boxfulRows.length,
        matched_rows: matchedRows,
        unmatched_rows: boxfulRows.length - matchedRows,
        status_summary: statusSummary,
      },
      store.id
    );
    try {
      await upsertBoxfulFileControl(
        {
          file_name: file.name,
          file_type: "logistica",
          cutoff_date: periodEnd,
          status: "importado",
          import_id: logisticsImport.id,
          imported_at: logisticsImport.created_at,
        },
        store.id
      );
    } catch (fileControlError) {
      console.warn("[finance/logistics file control]", fileControlError);
    }

    const rowsToInsert = pendingRows.map(({ row, shopify }) =>
      buildLogisticsRow(logisticsImport.id, row, store.id, shopify)
    );

    // Si las filas no entran, el import se revierte: un archivo nunca debe
    // quedar registrado con 0 filas.
    try {
      const batches: (typeof rowsToInsert)[] = [];
      for (let i = 0; i < rowsToInsert.length; i += INSERT_BATCH_SIZE) {
        batches.push(rowsToInsert.slice(i, i + INSERT_BATCH_SIZE));
      }
      for (let i = 0; i < batches.length; i += INSERT_CONCURRENCY) {
        await Promise.all(batches.slice(i, i + INSERT_CONCURRENCY).map(insertLogisticsRows));
      }
    } catch (insertError) {
      await deleteLogisticsImport(logisticsImport.id, store.id).catch(() => undefined);
      const detail = insertError instanceof Error ? insertError.message : String(insertError);
      throw new Error(`No se pudieron guardar las filas (import revertido): ${detail}`);
    }

    // El import muto logistics_rows: refresca la cache durable del dataset para
    // que el dashboard refleje el cambio sin esperar al cron. Defensivo: nunca
    // debe romper el import si la cache falla.
    await refreshFinanceDatasetCache(store).catch((cacheErr) =>
      console.warn("[finance/logistics POST cache]", cacheErr)
    );

    return NextResponse.json({
      import: logisticsImport,
      matched_rows: matchedRows,
      unmatched_rows: boxfulRows.length - matchedRows,
      status_summary: statusSummary,
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al importar logistica");
    console.error("[finance/logistics POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteLogisticsImport(id, store.id);
    await refreshFinanceDatasetCache(store).catch((cacheErr) =>
      console.warn("[finance/logistics DELETE cache]", cacheErr)
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al eliminar logistica");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function missingStoreResponse() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}

function buildLogisticsRow(
  importId: number,
  row: ParsedLogisticsRow,
  storeId: number,
  shopify?: ShopifyOrder
): Omit<LogisticsRow, "id" | "created_at"> {
  const internalStatus = mapInternalStatus(row.boxful_status, shopify);
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
    boxful_status: row.boxful_status,
    internal_status: internalStatus,
    match_status: shopify ? "matched" : "unmatched",
    service_type: row.service_type,
    cod_amount: row.cod_amount,
    cod_commission: row.cod_commission,
    delivery_cost: row.delivery_cost,
    total_cost: row.total_cost,
    liquidated_on: row.liquidated_on,
    finalized_on: row.finalized_on,
    label_url: row.label_url,
    package_items: row.package_items,
    shopify_order_id: shopify ? String(shopify.id) : "",
    shopify_order_name: shopify?.name ?? "",
    shopify_order_number: shopify?.order_number ?? null,
    shopify_financial_status: shopify?.financial_status ?? "",
    shopify_fulfillment_status: shopify?.fulfillment_status ?? "",
    shopify_cancelled_at: shopify?.cancelled_at ?? null,
    shopify_total: Number(shopify?.total_price ?? 0),
    // "" en timestamptz revienta el insert; solo fechas reales o null.
    shopify_created_at: shopify?.created_at || null,
    raw_row: row.raw,
  };
}

function mapInternalStatus(status: string, shopify?: ShopifyOrder): InternalOrderStatus {
  const lower = status.toLowerCase();
  if (lower.includes("entregado") && !lower.includes("no entregado")) return "delivered";
  if (lower.includes("no entregado") || lower.includes("devuelto")) return "not_delivered";

  if (shopify?.cancelled_at || shopify?.financial_status === "voided") return "pending";

  return "pending";
}

function nullableDate(value: string): string | null {
  return value ? value : null;
}
