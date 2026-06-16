import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { buildShopifyNoteAliasRows, type ShopifyNoteAliasRow } from "@/lib/finance-orders";
import { getOrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 30;

// Cache simple por tienda (TTL ~30s) de los alias de notas. La lista es pequena;
// el cliente hace la busqueda de texto + el filtro "solo con codigo" en memoria.
const NOTES_TTL_MS = 30_000;
type NotesPayload = { rows: ShopifyNoteAliasRow[]; shopifyOrderCount: number };
const notesCache = new Map<string, { at: number; data: NotesPayload }>();

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
    const cached = notesCache.get(store.code);
    if (cached && Date.now() - cached.at < NOTES_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    const { shopifyOrders } = await getOrdersDataset(store);
    const data: NotesPayload = {
      rows: buildShopifyNoteAliasRows(shopifyOrders),
      shopifyOrderCount: shopifyOrders.length,
    };
    notesCache.set(store.code, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al cargar notas Shopify");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
