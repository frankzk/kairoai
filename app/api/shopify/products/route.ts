import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface ShopifyProductOption {
  variant_id: number;
  product_id: number;
  product_title: string;
  variant_title: string;
  display_name: string; // "Shampoo de Romero — 250ml"
  sku: string;
  price: number; // in store currency (CRC colones)
  image_url?: string;
}

export async function GET() {
  if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "Shopify no configurado. Agregá SHOPIFY_SHOP_DOMAIN y SHOPIFY_ACCESS_TOKEN en Vercel." },
      { status: 503 }
    );
  }

  // Fetch up to 250 products with their variants
  const url = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/products.json?limit=250&fields=id,title,variants,image`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    next: { revalidate: 300 }, // cache 5 min
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
        variant.title && variant.title !== "Default Title"
          ? ` — ${variant.title}`
          : "";
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

  return NextResponse.json({ products });
}
