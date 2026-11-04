import { NextRequest, NextResponse } from "next/server";
import { anunciantesTiktok } from "@/lib/tiktok-diario";
import { getDB } from "@/lib/db";
import { identidadActual } from "@/lib/identidad";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  buildGroupMetrics,
  selectionTarget,
} from "@/lib/marketing-product-groups-server";
import { marketingPeriod, marketingDate } from "@/lib/marketing-dates";
import { getMarketingInputs, getMarketingData } from "@/lib/marketing-data";
import { presetPeriod } from "@/lib/marketing-dates";
import { metaAccountIds } from "@/lib/marketing-sources";
import { campaignAlias } from "@/lib/marketing-product-families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });
function access(req: NextRequest) {
  const actor = identidadActual();
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  return actor?.permisos.includes("marketing") &&
    actor.tiendas.includes("mireva-cr") &&
    store?.code === "mireva-cr"
    ? { actor, store }
    : null;
}
export async function GET(req: NextRequest) {
  const allowed = access(req);
  if (!allowed)
    return reply(
      { error: "Se requiere Marketing y acceso a Mireva Costa Rica." },
      403,
    );
  try {
    const readAll = async (table: string, fields: string) => {
      const rows: Record<string, unknown>[] = [];
      for (let page = 0; page < 10; page++) {
        let query = getDB()
          .from(table)
          .select(fields)
          .eq("store_id", allowed!.store.id);
        query =
          table === "marketing_campaign_products"
            ? query.order("platform").order("account_id").order("campaign_id")
            : query.order("product_key");
        const result = await query.range(page * 1000, page * 1000 + 999);
        if (result.error || !result.data)
          throw new Error("Settings unavailable");
        rows.push(...(result.data as unknown as Record<string, unknown>[]));
        if (result.data.length < 1000) return rows;
      }
      throw new Error("Settings pagination limit");
    };
    const [mappings, plans] = await Promise.all([
      readAll(
        "marketing_campaign_products",
        "platform,account_id,campaign_id,product_key,product_name,sku,family_key,variant_scope,variant_keys,campaign_alias,updated_at",
      ),
      readAll(
        "marketing_product_plans",
        "product_key,product_name,sku,priority,supplier,lead_days,cover_days,incoming_units,updated_at",
      ),
    ]);
    return reply({ mappings, plans });
  } catch {
    return reply(
      {
        error:
          "No se pudieron cargar las asignaciones y prioridades. Vuelve a actualizar.",
      },
      503,
    );
  }
}
export async function PATCH(req: NextRequest) {
  const allowed = access(req);
  if (!allowed || (allowed.actor.permisos as string[]).includes("solo_lectura"))
    return reply({ error: "No tienes permiso para modificar Marketing." }, 403);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 32768)
      return reply({ error: "Solicitud demasiado grande." }, 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    body = parsed;
  } catch {
    return reply({ error: "Solicitud inválida." }, 400);
  }
  const { store, actor } = allowed;
  if (!["mapping", "plan"].includes(String(body.kind)))
    return reply({ error: "Tipo de ajuste inválido." }, 400);
  const audit = {
    store_id: store.id,
    updated_by: `${actor.id}:${actor.nombre}`.slice(0, 200),
    updated_at: new Date().toISOString(),
  };
  try {
    if (body.kind === "mapping") {
      const platform = body.platform,
        account = body.account_id,
        campaign = body.campaign_id;
      // TikTok: la cuenta configurada o las que ya mandaron gasto por Make.
      const ids =
        platform === "meta"
          ? metaAccountIds(process.env)
          : platform === "tiktok"
            ? [
                process.env.TIKTOK_CR_ADVERTISER_ID,
                ...(await anunciantesTiktok(store.id).catch(() => [])),
              ]
            : [];
      if (
        typeof account !== "string" ||
        !ids.includes(account) ||
        typeof campaign !== "string" ||
        !/^\d{1,40}$/.test(campaign)
      )
        return reply(
          { error: "Cuenta o campaña no autorizada para Costa Rica." },
          400,
        );
      if (body.product_key === null) {
        if (body.disable_auto === true) {
          const result = await getDB()
            .from("marketing_campaign_products")
            .upsert(
              {
                ...audit,
                platform,
                account_id: account,
                campaign_id: campaign,
                product_key: "unassigned",
                product_name: "Sin asignar",
                sku: "",
                family_key: null,
                variant_scope: "none",
                variant_keys: [],
                campaign_alias: null,
              },
              { onConflict: "store_id,platform,account_id,campaign_id" },
            );
          if (result.error) throw new Error();
          return reply({ saved: true });
        }
        const result = await getDB()
          .from("marketing_campaign_products")
          .delete()
          .eq("store_id", store.id)
          .eq("platform", platform)
          .eq("account_id", account)
          .eq("campaign_id", campaign);
        if (result.error) throw new Error();
        return reply({ saved: true });
      }
    }
    if (body.kind === "mapping" && typeof body.family_key === "string") {
      if (
        body.learn_alias !== undefined &&
        typeof body.learn_alias !== "boolean"
      )
        return reply({ error: "Indica si quieres recordar el alias." }, 400);
      const alias =
        body.learn_alias === true &&
        typeof body.campaign_name === "string" &&
        body.campaign_name.length <= 1000
          ? campaignAlias(body.campaign_name)
          : null;
      if (body.learn_alias === true && !alias)
        return reply(
          {
            error:
              "El nombre de campaña es demasiado genérico o largo para aprenderlo como alias.",
          },
          400,
        );
      if (
        body.family_key.length > 300 ||
        !["all", "selected"].includes(String(body.variant_scope)) ||
        (body.variant_scope === "selected" &&
          (!Array.isArray(body.variant_keys) ||
            !body.variant_keys.length ||
            body.variant_keys.length > 300 ||
            body.variant_keys.some(
              (k) => typeof k !== "string" || k.length > 300,
            )))
      )
        return reply(
          { error: "Selecciona variantes válidas del mismo producto." },
          400,
        );
      const period =
        body.from !== undefined || body.to !== undefined
          ? marketingPeriod(String(body.from || ""), String(body.to || ""))
          : presetPeriod("today");
      if (!period || period.to > marketingDate())
        return reply({ error: "Período inválido." }, 400);
      const input = await getMarketingInputs(store, period);
      if (input.summary.familyDataError)
        return reply(
          {
            error:
              "El catálogo de variantes está incompleto. Actualiza y vuelve a intentarlo.",
          },
          503,
        );
      const family = input.summary.productFamilies?.find(
        (f) => f.key === body.family_key,
      );
      if (!family)
        return reply(
          {
            error:
              "El producto agrupado no está disponible en el catálogo de Costa Rica.",
          },
          400,
        );
      let target: ReturnType<typeof selectionTarget>;
      try {
        target = selectionTarget(
          family,
          body.variant_scope === "all" ? null : (body.variant_keys as string[]),
        );
      } catch {
        return reply(
          { error: "Elige al menos una variante válida del mismo producto." },
          400,
        );
      }
      const result = await getDB()
        .from("marketing_campaign_products")
        .upsert(
          {
            ...audit,
            platform: body.platform,
            account_id: body.account_id,
            campaign_id: body.campaign_id,
            product_key: target.key,
            product_name: target.name.slice(0, 200),
            sku: target.sku,
            family_key: family.key,
            variant_scope: target.scope,
            variant_keys: target.scope === "all" ? [] : target.memberKeys,
            campaign_alias: alias,
          },
          { onConflict: "store_id,platform,account_id,campaign_id" },
        );
      if (result.error) throw new Error();
      return reply({
        saved: true,
        period: { from: period.from, to: period.to },
        productMetric: buildGroupMetrics(input.orders, period, [target])[0],
      });
    }
    if (typeof body.product_key !== "string" || body.product_key.length > 300)
      return reply({ error: "Selecciona un producto del catálogo." }, 400);
    const snapshot = await getMarketingData(store, presetPeriod("today"));
    const product = snapshot.catalog.find(
      (item) => item.key === body.product_key,
    );
    if (
      !product ||
      !product.name ||
      product.name.length > 200 ||
      product.sku.length > 100
    )
      return reply(
        {
          error: "El producto no está disponible en el catálogo de Costa Rica.",
        },
        400,
      );
    const productData = {
      product_key: product.key,
      product_name: product.name,
      sku: product.sku,
    };
    if (body.kind === "mapping") {
      const result = await getDB()
        .from("marketing_campaign_products")
        .upsert(
          {
            ...audit,
            ...productData,
            family_key: null,
            variant_scope: "legacy",
            variant_keys: [],
            campaign_alias: null,
            platform: body.platform,
            account_id: body.account_id,
            campaign_id: body.campaign_id,
          },
          { onConflict: "store_id,platform,account_id,campaign_id" },
        );
      if (result.error) throw new Error();
    } else {
      const whole = (value: unknown, min: number, max: number) =>
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= min &&
        value <= max;
      if (
        typeof body.priority !== "boolean" ||
        typeof body.supplier !== "string" ||
        body.supplier.length > 120 ||
        !(body.lead_days === null || whole(body.lead_days, 0, 365)) ||
        !(body.cover_days === null || whole(body.cover_days, 1, 365)) ||
        !whole(body.incoming_units, 0, 10_000_000)
      )
        return reply(
          {
            error:
              "Revisa proveedor, plazos y unidades en camino. Los días y unidades deben ser enteros positivos.",
          },
          400,
        );
      const result = await getDB()
        .from("marketing_product_plans")
        .upsert(
          {
            ...audit,
            ...productData,
            priority: body.priority,
            supplier: body.supplier.trim(),
            lead_days: body.lead_days,
            cover_days: body.cover_days,
            incoming_units: body.incoming_units,
          },
          { onConflict: "store_id,product_key" },
        );
      if (result.error) throw new Error();
    }
    return reply({ saved: true });
  } catch {
    return reply(
      {
        error:
          "No se pudo guardar. El ajuste anterior se conserva; vuelve a intentarlo.",
      },
      503,
    );
  }
}
