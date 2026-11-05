// Registro de actividad de las cuentas de Meta (GET /act_X/activities): cuándo
// se tocó el presupuesto, la puja, los creativos o el estado de cada campaña.
// Las reglas de Marketing ("En espera, no tocar" 48–72 h, "Escalar +20%")
// usan el último cambio. Solo lectura; los mensajes del proveedor nunca se
// reenvían al navegador.
import { metaTime } from "./marketing-meta-budgets";
import type { CampaignChange } from "./marketing-source-types";

export type { CampaignChange };

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const str = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";

/** Meta event types we care about; anything else is dropped (null). */
export function classifyMetaActivity(
  eventType: string,
): CampaignChange["kind"] | null {
  const type = eventType.toLowerCase();
  if (/budget|spend_cap/.test(type)) return "presupuesto";
  if (/bid/.test(type)) return "puja";
  if (/create_campaign_group|create_campaign$/.test(type)) return "lanzamiento";
  if (/(create|update)_ad(_creative)?$|creative/.test(type)) return "creativo";
  if (/run_status|status|archive|delete/.test(type)) return "estado";
  return null;
}

function extraData(value: unknown): Json {
  if (typeof value === "string") {
    try {
      return obj(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return obj(value);
}

/** Old/new values in extra_data come as numbers, strings or `{ old_value: n }` wrappers. */
function amount(value: unknown, key: string): number | null {
  const raw =
    value && typeof value === "object"
      ? (obj(value)[key] ?? obj(value).value)
      : value;
  const text = str(raw).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

const formatMinor = (minor: number) => (minor / 100).toFixed(2);

export function normalizeMetaActivities(
  rows: unknown[],
  accountId: string,
  adsetCampaign: Map<string, string>,
  currency = "USD",
): CampaignChange[] {
  const campaigns = new Set(adsetCampaign.values());
  const changes: CampaignChange[] = [];
  for (const raw of rows) {
    const row = obj(raw);
    const actor = str(row.actor_id).trim();
    // System events ("Ad delivered", reviews) have actor 0 or none: not a team change.
    if (!actor || actor === "0") continue;
    const eventType = str(row.event_type);
    const kind = classifyMetaActivity(eventType);
    if (!kind) continue;
    const at = metaTime(row.event_time);
    if (!at) continue;
    const extra = extraData(row.extra_data);
    const objectId = str(row.object_id);
    const objectType = str(row.object_type).toUpperCase();
    let campaignId: string | null = null;
    if (objectType === "CAMPAIGN_GROUP") campaignId = objectId || null;
    else if (objectType === "CAMPAIGN")
      campaignId = adsetCampaign.get(objectId) ?? null;
    else if (objectType === "ADGROUP") {
      // Older Graph names: "campaign" may mean the ad set. Accept the id only
      // when it resolves to a known campaign, directly or through its ad set.
      for (const candidate of [
        str(extra.campaign_group_id),
        str(extra.campaign_id),
      ]) {
        if (!candidate) continue;
        const resolved =
          adsetCampaign.get(candidate) ??
          (campaigns.has(candidate) ? candidate : null);
        if (resolved) {
          campaignId = resolved;
          break;
        }
      }
    }
    if (!campaignId || !/^\d{1,40}$/.test(campaignId)) continue;
    let detail = (str(row.translated_event_type) || eventType).slice(0, 120);
    if (
      (kind === "presupuesto" || kind === "puja") &&
      ["USD", "CRC"].includes(currency)
    ) {
      const before = amount(extra.old_value, "old_value");
      const after = amount(extra.new_value, "new_value");
      if (before != null && after != null)
        detail = `${detail}: ${formatMinor(before)} → ${formatMinor(after)}`;
    }
    const by = str(row.actor_name).trim().slice(0, 80);
    changes.push({
      platform: "meta",
      accountId,
      campaignId,
      at,
      kind,
      detail,
      source: "meta",
      ...(by ? { by } : {}),
    });
  }
  return changes.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Reads the account activity log since a CR date (inclusive) until now.
 * Rebuilds every page URL with the cursor; never follows provider URLs.
 */
export async function readMetaActivities(
  base: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
  since: string,
  adsetCampaign: Map<string, string>,
  options: { currency?: string; now?: Date } = {},
): Promise<CampaignChange[]> {
  const sinceTime = Date.parse(`${since}T06:00:00Z`);
  if (!Number.isFinite(sinceTime)) throw new Error("Invalid activity range");
  const accountId = /act_(\d+)/.exec(base)?.[1];
  if (!accountId) throw new Error("Invalid activity account");
  const rows: unknown[] = [];
  let after = "";
  for (let page = 0; page < 25; page++) {
    const url = new URL(`${base}/activities`);
    url.searchParams.set(
      "fields",
      "event_time,event_type,translated_event_type,object_id,object_type,actor_id,actor_name,extra_data",
    );
    url.searchParams.set("since", String(Math.floor(sinceTime / 1000)));
    url.searchParams.set(
      "until",
      String(Math.floor((options.now ?? new Date()).getTime() / 1000)),
    );
    url.searchParams.set("limit", "500");
    if (after) url.searchParams.set("after", after);
    const response = await fetcher(url, {
      headers,
      signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new Error("Activity unavailable");
    const body = obj(await response.json());
    if (body.error || !Array.isArray(body.data))
      throw new Error("Invalid activity");
    rows.push(...body.data);
    const paging = obj(body.paging);
    if (!paging.next)
      return normalizeMetaActivities(
        rows,
        accountId,
        adsetCampaign,
        options.currency,
      );
    const cursor = str(obj(paging.cursors).after);
    if (!cursor || cursor === after) throw new Error("Incomplete activity");
    after = cursor;
  }
  throw new Error("Activity pagination limit");
}

/** Without the activity log: one "last edit" entry per campaign from `updated_time`. */
export function changesFromUpdatedTime(
  accountId: string,
  campaigns: Array<{ id: string; updatedTime?: string | null }>,
): CampaignChange[] {
  return campaigns
    .filter((c): c is { id: string; updatedTime: string } =>
      Boolean(c.updatedTime),
    )
    .map((c) => ({
      platform: "meta" as const,
      accountId,
      campaignId: c.id,
      at: c.updatedTime,
      kind: "otro" as const,
      detail: "Última edición en Meta (sin detalle)",
      source: "meta_edicion" as const,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
