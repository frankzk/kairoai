import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { runShopifyDraftCartSync } from "@/lib/shopify-draft-carts";
import {
  fetchOpenShopifyDraftOrders,
  SHOPIFY_DRAFT_ACTIVE_DAYS,
  ShopifyDraftOrdersError,
} from "@/lib/shopify-draft-orders";

export const runtime = "nodejs";
export const maxDuration = 300;

function requiredStore(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return {
      store: null,
      response: NextResponse.json(
        { error: "store requerido: usa mireva-cr o mireva-hn" },
        { status: 400 }
      ),
    };
  }
  return { store, response: null };
}

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Error al leer borradores de Shopify";
  const status =
    error instanceof ShopifyDraftOrdersError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const resolved = requiredStore(req);
  if (!resolved.store) return resolved.response;

  try {
    const drafts = await fetchOpenShopifyDraftOrders(resolved.store);
    const orders = drafts.map((draft) => ({
      id: draft.id,
      name: draft.name,
      customer_name: draft.customerName,
      phone: draft.phone,
      email: draft.email,
      products: draft.products,
      item_count: draft.itemCount,
      total: `${draft.total.toFixed(2)} ${draft.currency}`.trim(),
      total_amount: draft.total,
      currency: draft.currency,
      status: draft.status,
      invoice_url: draft.invoiceUrl,
      created_at: draft.createdAt,
      updated_at: draft.updatedAt,
    }));
    return NextResponse.json({
      orders,
      total: orders.length,
      store: resolved.store.code,
      window_days: SHOPIFY_DRAFT_ACTIVE_DAYS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// Sincronizacion explicita desde la pestana Carrito de Leads. Es idempotente:
// vuelve a leer los borradores abiertos y actualiza por store_id + draft id.
export async function POST(req: NextRequest) {
  const resolved = requiredStore(req);
  if (!resolved.store) return resolved.response;

  try {
    return NextResponse.json(await runShopifyDraftCartSync(resolved.store));
  } catch (error) {
    return errorResponse(error);
  }
}
