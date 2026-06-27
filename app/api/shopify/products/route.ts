import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams, getShopifyCredentials } from "@/lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ShopifyProductOption {
  variant_id: number;
  product_id: number;
  product_title: string;
  variant_title: string;
  display_name: string;
  sku: string;
  price: number;
  image_url?: string;
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
      { error: `Shopify ${store.shortLabel} no configurado. Agrega ${missing.join(" y ")} en Vercel.` },
      { status: 503 }
    );
  }

  const url = `https://${shop}/admin/api/2024-01/products.json?limit=250&fields=id,title,variants,image`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Shopify error ${res.status}: ${text}` },
      { status: res.status }
    );
  }

  const data = await res.json();
  const products: ShopifyProductOption[] = [];

  for (const product of data.products ?? []) {
    const imageUrl = product.image?.src ?? undefined;
    for (const variant of product.variants ?? []) {
      const variantLabel =
        variant.title && variant.title !== "Default Title" ? ` - ${variant.title}` : "";
      products.push({
        variant_id: variant.id,
        product_id: product.id,
        product_title: product.title,
        variant_title: variant.title ?? "",
        display_name: `${product.title}${variantLabel}`,
        sku: variant.sku ?? "",
        price: Math.round(parseFloat(variant.price ?? "0")),
        image_url: imageUrl,
      });
    }
  }

  return NextResponse.json({ products, store: store.code });
}
