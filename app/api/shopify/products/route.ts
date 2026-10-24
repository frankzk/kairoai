import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams, getShopifyCredentials } from "@/lib/stores";
import { cargarCatalogoRespaldo } from "@/lib/catalogo-respaldo";

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
  // Desde el 28/10/2026 Shopify esta suspendido: si no contesta, el catalogo
  // sale del respaldo (lib/catalogo-respaldo.ts) con la misma forma.
  const desdeRespaldo = async (motivo: string) => {
    try {
      const products = await cargarCatalogoRespaldo(store.id);
      if (products.length) return NextResponse.json({ products, store: store.code, fuente: "respaldo", motivo });
    } catch (err) {
      console.warn(`[shopify/products] respaldo ${store.code}:`, err instanceof Error ? err.message : err);
    }
    return null;
  };

  const { shop, token, missing } = getShopifyCredentials(store);
  if (!shop || !token) {
    return (
      (await desdeRespaldo("Shopify sin configurar")) ??
      NextResponse.json(
        { error: `Shopify ${store.shortLabel} no configurado. Agrega ${missing.join(" y ")} en Vercel.` },
        { status: 503 }
      )
    );
  }

  // Pagina con el cursor page_info (Link header) para no topar en 250
  // productos: con el tope, variantes reales quedaban fuera del picker y la
  // asesora "no podia elegir talla". MAX_PAGES es un freno de seguridad
  // (20 x 250 = 5000 productos).
  const MAX_PAGES = 20;
  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };
  const rawProducts: Array<Record<string, unknown>> = [];
  let url = `https://${shop}/admin/api/2024-01/products.json?limit=250&fields=id,title,variants,image`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    let res: Response;
    try {
      res = await fetch(url, { headers, next: { revalidate: 300 } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "sin respuesta";
      return (
        (await desdeRespaldo(`Shopify no respondio: ${message}`)) ??
        NextResponse.json({ error: `Shopify no respondio: ${message}` }, { status: 502 })
      );
    }
    if (!res.ok) {
      const text = await res.text();
      return (
        (await desdeRespaldo(`Shopify error ${res.status}`)) ??
        NextResponse.json({ error: `Shopify error ${res.status}: ${text}` }, { status: res.status })
      );
    }
    const data = await res.json();
    rawProducts.push(...(data.products ?? []));
    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : "";
  }

  const products: ShopifyProductOption[] = [];

  for (const product of rawProducts as Array<{
    id: number;
    title: string;
    image?: { src?: string };
    variants?: Array<{ id: number; title?: string; sku?: string; price?: string }>;
  }>) {
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
