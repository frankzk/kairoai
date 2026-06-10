import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  createLogisticsImport,
  deleteLogisticsImport,
  insertLogisticsRows,
  listLogisticsImports,
  listLogisticsRows,
  type InternalOrderStatus,
  type LogisticsPackageItem,
  type LogisticsRow,
} from "@/lib/finance";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ParsedLogisticsRow {
  raw: Record<string, unknown>;
  guide_number: string;
  order_name: string;
  store_order_number: string;
  customer_name: string;
  customer_phone: string;
  created_on: string | null;
  courier: string;
  boxful_status: string;
  service_type: string;
  cod_amount: number;
  cod_commission: number;
  delivery_cost: number;
  total_cost: number;
  liquidated_on: string | null;
  finalized_on: string | null;
  label_url: string;
  package_items: LogisticsPackageItem[];
}

interface ShopifyOrder {
  id: number;
  name: string;
  order_number: number;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  total_price: string;
}

export async function GET(req: NextRequest) {
  try {
    const importId = Number(req.nextUrl.searchParams.get("import_id"));
    const [imports, rows] = await Promise.all([
      listLogisticsImports(),
      listLogisticsRows(importId || undefined),
    ]);
    return NextResponse.json({ imports, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer logistica";
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

    const periodLabel = String(form.get("period_label") ?? "");
    const periodStart = nullableDate(String(form.get("period_start") ?? ""));
    const periodEnd = nullableDate(String(form.get("period_end") ?? ""));

    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const boxfulRows = parseBoxfulRows(workbook);
    if (!boxfulRows.length) {
      return NextResponse.json({ error: "No se encontraron filas logisticas" }, { status: 400 });
    }

    const shopifyOrders = await fetchShopifyOrders(periodStart ?? inferEarliestDate(boxfulRows));
    const indexes = buildShopifyIndexes(shopifyOrders);
    const statusSummary: Record<string, { count: number }> = {};
    let matchedRows = 0;

    const pendingRows = boxfulRows.map((row) => {
      const shopify = findShopifyMatch(row.order_name, indexes);
      if (shopify) matchedRows++;

      statusSummary[row.boxful_status] = {
        count: (statusSummary[row.boxful_status]?.count ?? 0) + 1,
      };

      return { row, shopify };
    });

    const logisticsImport = await createLogisticsImport({
      file_name: file.name,
      period_label: periodLabel,
      period_start: periodStart,
      period_end: periodEnd,
      total_rows: boxfulRows.length,
      matched_rows: matchedRows,
      unmatched_rows: boxfulRows.length - matchedRows,
      status_summary: statusSummary,
    });

    const rowsToInsert = pendingRows.map(({ row, shopify }) =>
      buildLogisticsRow(logisticsImport.id, row, shopify)
    );

    for (let i = 0; i < rowsToInsert.length; i += 250) {
      await insertLogisticsRows(rowsToInsert.slice(i, i + 250));
    }

    return NextResponse.json({
      import: logisticsImport,
      matched_rows: matchedRows,
      unmatched_rows: boxfulRows.length - matchedRows,
      status_summary: statusSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al importar logistica";
    console.error("[finance/logistics POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteLogisticsImport(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al eliminar logistica";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseBoxfulRows(workbook: XLSX.WorkBook): ParsedLogisticsRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  return rows
    .map((raw) => {
      const firstName = text(raw.Nombre);
      const lastName = text(raw.Apellido);
      return {
        raw,
        guide_number: text(raw["No. Guia"]),
        order_name: text(raw.Orden),
        store_order_number: text(raw["No. Orden tienda"]),
        customer_name: `${firstName} ${lastName}`.trim(),
        customer_phone: text(raw.Telefono),
        created_on: parseDate(text(raw["Creado en"])),
        courier: text(raw.Courier),
        boxful_status: text(raw.Estado),
        service_type: text(raw["Tipo de Servicio"]),
        cod_amount: money(raw["Monto COD"]),
        cod_commission: money(raw["Monto de comision COD"]),
        delivery_cost: money(raw["Costo de entrega"]),
        total_cost: money(raw.Total),
        liquidated_on: parseDate(text(raw["Liquidado en"])),
        finalized_on: parseDate(text(raw["Finalización"])),
        label_url: text(raw.Etiqueta),
        package_items: parsePackageItems(raw),
      };
    })
    .filter((row) => row.guide_number || row.order_name);
}

function parsePackageItems(raw: Record<string, unknown>): LogisticsPackageItem[] {
  const items: LogisticsPackageItem[] = [];
  for (let i = 1; i <= 4; i++) {
    const title = text(raw[`Paquete ${i}`]);
    if (!title) continue;
    items.push({
      title,
      quantity: Number(text(raw[`Cantidad Paquete ${i}`]) || 0),
      price: money(raw[`Precio Paquete ${i}`]),
    });
  }
  return items;
}

async function fetchShopifyOrders(periodStart: string | null): Promise<ShopifyOrder[]> {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!shop || !token) return [];

  const minDate = periodStart
    ? new Date(new Date(periodStart).getTime() - 45 * 24 * 60 * 60 * 1000).toISOString()
    : "2026-01-01T00:00:00-06:00";

  let url =
    `https://${shop}/admin/api/2024-01/orders.json` +
    `?status=any&limit=250&order=created_at%20desc` +
    `&created_at_min=${encodeURIComponent(minDate)}` +
    `&fields=id,name,order_number,created_at,financial_status,fulfillment_status,cancelled_at,total_price`;

  const orders: ShopifyOrder[] = [];
  for (let page = 0; page < 80 && url; page++) {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) break;

    const json = (await res.json()) as { orders?: ShopifyOrder[] };
    orders.push(...(json.orders ?? []));

    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? "";
  }
  return orders;
}

function buildShopifyIndexes(orders: ShopifyOrder[]) {
  return {
    byName: new Map(orders.map((order) => [order.name, order])),
    byMcrcNumber: new Map(orders.map((order) => [`#MCRC${order.order_number}`, order])),
    byOrderNumber: new Map(orders.map((order) => [String(order.order_number), order])),
  };
}

function findShopifyMatch(
  orderName: string,
  indexes: ReturnType<typeof buildShopifyIndexes>
): ShopifyOrder | undefined {
  const raw = orderName.trim();
  return (
    indexes.byName.get(raw) ??
    indexes.byMcrcNumber.get(raw.startsWith("#") ? raw : `#MCRC${raw}`) ??
    indexes.byOrderNumber.get(raw.replace(/^#?MCRC/i, ""))
  );
}

function buildLogisticsRow(
  importId: number,
  row: ParsedLogisticsRow,
  shopify?: ShopifyOrder
): Omit<LogisticsRow, "id" | "created_at"> {
  const internalStatus = mapInternalStatus(row.boxful_status, shopify);
  return {
    import_id: importId,
    guide_number: row.guide_number,
    order_name: row.order_name,
    store_order_number: row.store_order_number,
    customer_name: row.customer_name,
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
    shopify_created_at: shopify?.created_at ?? null,
    raw_row: row.raw,
  };
}

function mapInternalStatus(status: string, shopify?: ShopifyOrder): InternalOrderStatus {
  if (shopify?.cancelled_at || shopify?.financial_status === "voided") return "annulled";

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
  if (!value || value === "-") return null;
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

function inferEarliestDate(rows: ParsedLogisticsRow[]): string | null {
  const dates = rows
    .map((row) => row.created_on)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates[0] ?? null;
}
