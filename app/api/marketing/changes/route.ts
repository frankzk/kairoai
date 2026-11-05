// Registro manual de cambios por campaña (presupuesto, puja, creativo,
// estado, lanzamiento). TikTok llega por Make sin historial de cambios, y
// Meta puede no dar su registro de actividad: el equipo lo anota aquí.
import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import {
  canEditMarketing,
  marketingAccess,
  marketingAccountIds,
  marketingAuthor,
  marketingReply,
  readJsonBody,
} from "@/lib/marketing-access";
import {
  displayUploader,
  isMissingRelation,
} from "@/lib/marketing-inventory-db";
import type {
  CampaignChange,
  ManualCampaignChange,
} from "@/lib/marketing-source-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "marketing_campaign_changes";
const PENDING = "Pendiente: aplicar migración del registro de cambios.";
const KINDS: CampaignChange["kind"][] = [
  "presupuesto",
  "puja",
  "creativo",
  "estado",
  "lanzamiento",
  "otro",
];
const DAY = 86_400_000;
const MAX_AGE_DAYS = 30;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const COLUMNS =
  "id,platform,account_id,campaign_id,campaign_name,product_key,kind,detail,changed_at,created_by";

type Row = {
  id: number | string;
  platform: "meta" | "tiktok";
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  product_key: string | null;
  kind: CampaignChange["kind"];
  detail: string;
  changed_at: string;
  created_by: string;
};

const toChange = (row: Row): ManualCampaignChange => ({
  platform: row.platform,
  accountId: row.account_id,
  campaignId: row.campaign_id,
  at: new Date(row.changed_at).toISOString(),
  kind: row.kind,
  detail: row.detail,
  source: "manual",
  id: String(row.id),
  by: displayUploader(row.created_by),
  campaignName: row.campaign_name,
  productKey: row.product_key,
});

export async function GET(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!allowed)
    return marketingReply(
      { error: "Se requiere Marketing y acceso a Mireva Costa Rica." },
      403,
    );
  const rawDays = req.nextUrl.searchParams.get("days");
  const days = rawDays == null ? MAX_AGE_DAYS : Number(rawDays);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    return marketingReply({ error: "days debe ser un entero de 1 a 90." }, 400);
  const since = new Date(Date.now() - days * DAY).toISOString();
  const changes: ManualCampaignChange[] = [];
  for (let page = 0; page < 10; page++) {
    const { data, error } = await getDB()
      .from(TABLE)
      .select(COLUMNS)
      .eq("store_id", allowed.store.id)
      .gte("changed_at", since)
      .order("changed_at", { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (error)
      return isMissingRelation(error)
        ? marketingReply({
            status: "pending_migration",
            message: PENDING,
            changes: [],
          })
        : marketingReply(
            { error: "No se pudo consultar el registro de cambios." },
            503,
          );
    const rows = (data ?? []) as unknown as Row[];
    changes.push(...rows.map(toChange));
    if (rows.length < 1000) break;
  }
  return marketingReply({ status: "ok", changes });
}

export async function POST(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!canEditMarketing(allowed))
    return marketingReply(
      { error: "No tienes permiso para modificar Marketing." },
      403,
    );
  const read = await readJsonBody(req, 8192);
  if ("error" in read) return read.error;
  const body = read.body;
  const ids = await marketingAccountIds(body.platform, allowed.store.id);
  if (
    typeof body.account_id !== "string" ||
    !/^\d{1,40}$/.test(body.account_id) ||
    !ids.includes(body.account_id) ||
    typeof body.campaign_id !== "string" ||
    !/^\d{1,40}$/.test(body.campaign_id)
  )
    return marketingReply(
      { error: "Cuenta o campaña no autorizada para Costa Rica." },
      400,
    );
  if (!KINDS.includes(body.kind as CampaignChange["kind"]))
    return marketingReply({ error: "Tipo de cambio inválido." }, 400);
  const campaignName =
    body.campaign_name === undefined ? "" : body.campaign_name;
  const detail = body.detail === undefined ? "" : body.detail;
  const productKey = body.product_key === undefined ? null : body.product_key;
  if (
    typeof campaignName !== "string" ||
    campaignName.length > 300 ||
    typeof detail !== "string" ||
    detail.trim().length > 200 ||
    !(
      productKey === null ||
      (typeof productKey === "string" &&
        productKey.length >= 5 &&
        productKey.length <= 300)
    )
  )
    return marketingReply(
      { error: "Revisa el detalle (máximo 200 caracteres) y el producto." },
      400,
    );
  const now = Date.now();
  const changedAt =
    body.changed_at === undefined || body.changed_at === null
      ? now
      : typeof body.changed_at === "string"
        ? Date.parse(body.changed_at)
        : NaN;
  if (
    !Number.isFinite(changedAt) ||
    changedAt > now + FUTURE_TOLERANCE_MS ||
    changedAt < now - MAX_AGE_DAYS * DAY
  )
    return marketingReply(
      {
        error:
          "La fecha del cambio no puede ser futura ni de hace más de 30 días.",
      },
      400,
    );
  const { data, error } = await getDB()
    .from(TABLE)
    .insert({
      store_id: allowed.store.id,
      platform: body.platform,
      account_id: body.account_id,
      campaign_id: body.campaign_id,
      campaign_name: campaignName.trim(),
      product_key: productKey,
      kind: body.kind,
      detail: detail.trim(),
      changed_at: new Date(changedAt).toISOString(),
      created_by: marketingAuthor(allowed.actor),
    })
    .select(COLUMNS)
    .single();
  if (error || !data)
    return marketingReply(
      {
        error: isMissingRelation(error)
          ? PENDING
          : "No se pudo guardar el cambio. Vuelve a intentarlo.",
      },
      503,
    );
  return marketingReply({
    saved: true,
    change: toChange(data as unknown as Row),
  });
}

export async function DELETE(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!canEditMarketing(allowed))
    return marketingReply(
      { error: "No tienes permiso para modificar Marketing." },
      403,
    );
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^\d{1,18}$/.test(id))
    return marketingReply({ error: "Cambio inválido." }, 400);
  const { error } = await getDB()
    .from(TABLE)
    .delete()
    .eq("store_id", allowed.store.id)
    .eq("id", id);
  if (error)
    return marketingReply(
      {
        error: isMissingRelation(error)
          ? PENDING
          : "No se pudo borrar el cambio. Vuelve a intentarlo.",
      },
      503,
    );
  return marketingReply({ saved: true });
}
