import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  createSettlementImport,
  deleteSettlementImport,
  insertSettlementRows,
  listSettlementImports,
  listSettlementRows,
  upsertBoxfulFileControl,
  type InternalOrderStatus,
  type SettlementOrderItem,
  type SettlementRow,
} from "@/lib/finance";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ParsedSettlementRow {
  raw: Record<string, unknown>;
  guide_number: string;
  order_name: string;
  store_order_number: string;
  customer_name: string;
  customer_phone: string;
  created_on: string | null;
  courier: string;
  service_type: string;
  cod_amount: number;
  cod_commission: number;
  card_commission: number;
  delivery_cost: number;
  pick_pack_cost: number;
  packaging_cost: number;
  amount_to_liquidate: number;
  settlement_status: string;
  internal_status: InternalOrderStatus;
}

interface ShopifySettlementOrder {
  id: number;
  name: string;
  order_number: number;
  note?: string | null;
  note_attributes?: Array<{ name?: string | null; value?: string | null }>;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  line_items?: Array<{
    sku?: string | null;
    title?: string;
    quantity?: number;
    price?: string;
  }>;
}

export async function GET(req: NextRequest) {
  try {
    const importId = Number(req.nextUrl.searchParams.get("import_id"));
    const [imports, rows] = await Promise.all([
      listSettlementImports(),
      listSettlementRows(importId || undefined),
    ]);
    return NextResponse.json({ imports, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer liquidaciones";
    return NextResponse.json({ imports: [], rows: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
    }

    const periodStart = nullableDate(String(form.get("period_start") ?? ""));
    const periodEnd = nullableDate(String(form.get("period_end") ?? ""));
    const periodLabel =
      String(form.get("period_label") ?? "").trim() || (periodEnd ? `Corte ${periodEnd}` : "");

    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const settlementRows = parseSettlementRows(workbook);
    if (!settlementRows.length) {
      return NextResponse.json({ error: "No se encontraron filas en la hoja Envios" }, { status: 400 });
    }

    const consolidated = parseConsolidated(workbook);
    const shopifyOrders = await fetchShopifyOrders(periodStart ?? inferEarliestDate(settlementRows));
    const indexes = buildShopifyIndexes(shopifyOrders);

    const statusSummary: Record<string, { count: number; amount_to_liquidate: number }> = {};
    let matchedRows = 0;

    const pendingRows = settlementRows.map((row) => {
      const shopify = findShopifyMatch(row.order_name, indexes);
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

    const settlementImport = await createSettlementImport({
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
    });
    try {
      await upsertBoxfulFileControl({
        file_name: file.name,
        file_type: "liquidacion",
        cutoff_date: periodEnd,
        status: "importado",
        import_id: settlementImport.id,
        imported_at: settlementImport.created_at,
      });
    } catch (fileControlError) {
      console.warn("[finance/settlements file control]", fileControlError);
    }

    const rowsToInsert = pendingRows.map(({ row, shopify }) =>
      buildSettlementRow(settlementImport.id, row, shopify)
    );

    for (let i = 0; i < rowsToInsert.length; i += 250) {
      await insertSettlementRows(rowsToInsert.slice(i, i + 250));
    }

    return NextResponse.json({
      import: settlementImport,
      matched_rows: matchedRows,
      unmatched_rows: settlementRows.length - matchedRows,
      status_summary: statusSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al importar liquidacion";
    console.error("[finance/settlements POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteSettlementImport(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al eliminar liquidacion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseSettlementRows(workbook: XLSX.WorkBook): ParsedSettlementRow[] {
  const sheet = workbook.Sheets.Envios ?? workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  return rows
    .map((raw) => {
      const firstName = text(raw.Nombre);
      const lastName = text(raw.Apellido);
      const settlementStatus = text(raw.Estado);
      return {
        raw,
        guide_number: text(raw["No. Guia"]),
        order_name: text(raw.Orden),
        store_order_number: text(raw["No. Orden tienda"]),
        customer_name: `${firstName} ${lastName}`.trim(),
        customer_phone: text(raw.Telefono),
        created_on: parseDate(text(raw["Creado en"])),
        courier: text(raw.Courier),
        service_type: text(raw["Tipo de Servicio"]),
        cod_amount: money(raw["Monto COD"]),
        cod_commission: money(raw["Monto de comision COD"]),
        card_commission: money(raw["Com. Tarjeta"]),
        delivery_cost: money(raw["Costo de entrega"]),
        pick_pack_cost: money(raw["Pick&Pack"]),
        packaging_cost: money(raw.Empaque),
        amount_to_liquidate: money(raw["A Liquidar"]),
        settlement_status: settlementStatus,
        internal_status: mapSettlementStatus(settlementStatus),
      };
    })
    .filter((row) => row.order_name || row.guide_number);
}

function parseConsolidated(workbook: XLSX.WorkBook): {
  total_collected: number;
  total_to_liquidate: number;
} {
  const sheet = workbook.Sheets.Consolidado;
  if (!sheet) return { total_collected: 0, total_to_liquidate: 0 };

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: ["description", "amount"],
    defval: "",
    raw: false,
  });

  let totalCollected = 0;
  let totalToLiquidate = 0;
  for (const row of rows) {
    const description = text(row.description).toLowerCase();
    if (description.includes("total colectado")) totalCollected = money(row.amount);
    if (description.includes("monto a liquidar") || description.includes("total a recibir")) {
      totalToLiquidate = money(row.amount);
    }
  }
  return { total_collected: totalCollected, total_to_liquidate: totalToLiquidate };
}

async function fetchShopifyOrders(periodStart: string | null): Promise<ShopifySettlementOrder[]> {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shop || !token) return [];

  const minDate = periodStart
    ? new Date(new Date(periodStart).getTime() - 45 * 24 * 60 * 60 * 1000).toISOString()
    : "2026-04-01T00:00:00-06:00";

  let url =
    `https://${shop}/admin/api/2024-01/orders.json` +
    `?status=any&limit=250&order=created_at%20desc` +
    `&created_at_min=${encodeURIComponent(minDate)}` +
    `&fields=id,name,order_number,note,note_attributes,created_at,financial_status,fulfillment_status,total_price,line_items`;

  const orders: ShopifySettlementOrder[] = [];
  for (let page = 0; page < 30 && url; page++) {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) break;

    const json = (await res.json()) as { orders?: ShopifySettlementOrder[] };
    orders.push(...(json.orders ?? []));

    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? "";
  }
  return orders;
}

function buildShopifyIndexes(orders: ShopifySettlementOrder[]) {
  const byExternalOrderCode = new Map<string, ShopifySettlementOrder>();
  for (const order of orders) {
    for (const code of getExternalOrderCodes(order)) {
      if (!byExternalOrderCode.has(code)) byExternalOrderCode.set(code, order);
    }
  }
  return {
    byName: new Map(orders.map((order) => [order.name, order])),
    byMcrcNumber: new Map(orders.map((order) => [`#MCRC${order.order_number}`, order])),
    byOrderNumber: new Map(orders.map((order) => [String(order.order_number), order])),
    byExternalOrderCode,
  };
}

function findShopifyMatch(
  orderName: string,
  indexes: ReturnType<typeof buildShopifyIndexes>
): ShopifySettlementOrder | undefined {
  const raw = orderName.trim();
  return (
    indexes.byName.get(raw) ??
    indexes.byMcrcNumber.get(raw.startsWith("#") ? raw : `#MCRC${raw}`) ??
    indexes.byExternalOrderCode.get(normalizeExternalOrderCode(raw)) ??
    indexes.byOrderNumber.get(raw.replace(/^#?MCRC/i, ""))
  );
}

function getExternalOrderCodes(order: ShopifySettlementOrder): string[] {
  const sources = [
    order.note ?? "",
    ...(order.note_attributes ?? []).flatMap((attribute) => [
      attribute.name ?? "",
      attribute.value ?? "",
    ]),
  ];
  return extractExternalOrderCodes(sources.join("\n"));
}

function extractExternalOrderCodes(value: string): string[] {
  const codes = new Set<string>();
  const patterns = [
    /\bpedido\s*#?\s*([0-9]{3,})\b/gi,
    /\border\s*#?\s*([0-9]{3,})\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      const code = normalizeExternalOrderCode(match[1] ?? "");
      if (code) codes.add(code);
    }
  }
  return Array.from(codes);
}

function normalizeExternalOrderCode(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/^mcrc/i, "")
    .replace(/\s+/g, "")
    .replace(/[^0-9]/g, "");
}

function buildSettlementRow(
  importId: number,
  row: ParsedSettlementRow,
  shopify?: ShopifySettlementOrder
): Omit<SettlementRow, "id" | "created_at"> {
  const orderItems: SettlementOrderItem[] = (shopify?.line_items ?? []).map((item) => ({
    sku: String(item.sku ?? "").toLowerCase(),
    title: String(item.title ?? ""),
    quantity: Number(item.quantity ?? 0),
    price: Number(item.price ?? 0),
  }));

  return {
    import_id: importId,
    guide_number: row.guide_number,
    order_name: row.order_name,
    store_order_number: row.store_order_number,
    customer_name: row.customer_name,
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
    shopify_created_at: shopify?.created_at ?? null,
    order_items: orderItems,
    raw_row: row.raw,
  };
}

function mapSettlementStatus(status: string): InternalOrderStatus {
  const lower = status.toLowerCase();
  if (lower.includes("entregado") && !lower.includes("no entregado")) return "delivered";
  if (lower.includes("no entregado") || lower.includes("devuelto")) return "not_delivered";
  return "pending";
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function money(value: unknown): number {
  const raw = text(value);
  if (!raw || raw === "-") return 0;
  return Number(raw.replace(/,/g, "").replace(/[^0-9.-]/g, "")) || 0;
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const parts = value.split(/[/-]/).map(Number);
  if (parts.length === 3 && parts[2] > 1900) {
    const [day, month, year] = parts;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function nullableDate(value: string): string | null {
  return value ? value : null;
}

function inferEarliestDate(rows: ParsedSettlementRow[]): string | null {
  const dates = rows
    .map((row) => row.created_on)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates[0] ?? null;
}

function sum(values: number[]): number {
  return roundMoney(values.reduce((acc, value) => acc + Number(value || 0), 0));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
