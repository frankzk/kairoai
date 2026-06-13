import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams, getShopifyCredentials } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ShopifyNoteOrder {
  id: number;
  order_number: number;
  name: string;
  note?: string | null;
  note_attributes?: Array<{ name?: string | null; value?: string | null }>;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  total_price: string;
  currency: string;
}

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  const { shop, token, missing } = getShopifyCredentials(store);
  if (!shop || !token) {
    return NextResponse.json(
      { error: `Shopify ${store.shortLabel} no configurado: faltan ${missing.join(" y ")} en Vercel.` },
      { status: 503 }
    );
  }

  const createdAtMin = req.nextUrl.searchParams.get("created_at_min") || getDefaultCreatedAtMin();
  const requestedMaxPages = Number(req.nextUrl.searchParams.get("max_pages") || 30);
  const maxPages = Math.min(Math.max(requestedMaxPages || 1, 1), 40);
  const fields = [
    "id",
    "order_number",
    "name",
    "financial_status",
    "fulfillment_status",
    "cancelled_at",
    "note",
    "note_attributes",
    "total_price",
    "currency",
    "created_at",
  ].join(",");

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    order: "created_at desc",
    created_at_min: createdAtMin,
    fields,
  });

  let url = `https://${shop}/admin/api/2024-01/orders.json?${params.toString()}`;
  const orders = [];
  let pagesChecked = 0;

  try {
    for (let page = 0; page < maxPages && url; page++) {
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json(
          { error: `Shopify error ${res.status}: ${text.slice(0, 200)}` },
          { status: res.status }
        );
      }

      const data = (await res.json()) as { orders?: ShopifyNoteOrder[] };
      for (const order of data.orders ?? []) {
        if (!hasShopifyNote(order)) continue;
        orders.push(mapNoteOrder(order));
      }

      pagesChecked += 1;
      const link = res.headers.get("link") ?? "";
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch?.[1] ?? "";
    }

    return NextResponse.json({
      orders,
      total: orders.length,
      partial: Boolean(url),
      max_pages: maxPages,
      pages_checked: pagesChecked,
      created_at_min: createdAtMin,
      store: store.code,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `Error al leer notas Shopify: ${message}` }, { status: 500 });
  }
}

function hasShopifyNote(order: ShopifyNoteOrder): boolean {
  const note = String(order.note ?? "").trim();
  const attributes = order.note_attributes ?? [];
  return Boolean(
    note ||
      attributes.some((attribute) =>
        Boolean(String(attribute.name ?? "").trim() || String(attribute.value ?? "").trim())
      )
  );
}

function mapNoteOrder(order: ShopifyNoteOrder) {
  return {
    id: String(order.id),
    order_number: Number(order.order_number ?? 0),
    name: String(order.name ?? ""),
    customer_name: "",
    phone: null,
    products: "",
    total: `${order.total_price ?? 0} ${order.currency ?? "CRC"}`,
    total_price: Number(order.total_price ?? 0),
    currency: String(order.currency ?? "CRC"),
    financial_status: String(order.financial_status ?? ""),
    fulfillment_status: order.fulfillment_status ?? null,
    cancelled_at: order.cancelled_at ?? null,
    note: String(order.note ?? ""),
    note_attributes: (order.note_attributes ?? []).map((attribute) => ({
      name: String(attribute.name ?? ""),
      value: String(attribute.value ?? ""),
    })),
    created_at: String(order.created_at ?? ""),
    line_items: [],
  };
}

function getDefaultCreatedAtMin(): string {
  const date = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return date.toISOString();
}
