import { describe, expect, it } from "vitest";
import {
  agoText,
  buildActionQueue,
  canMarkDone,
  filterFromAnchor,
  filterQueue,
  markDonePayload,
  queueCounts,
  queueImpact,
  type QueueItem,
} from "../lib/marketing-action-queue";
import {
  DECISION_LABEL,
  parseDoneMark,
  type CampaignDecision,
  type CreativeDecision,
  type DoneMark,
} from "../lib/marketing-decisions";
import type { CampaignChange } from "../lib/marketing-source-types";

const now = new Date("2026-11-13T20:35:00Z");
const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/[\u00a0\u202f]/g, " "));
const mark = (action: DoneMark["action"], minutes = 5): DoneMark => ({
  action,
  at: new Date(now.getTime() - minutes * 60_000).toISOString(),
  by: "Ana",
  id: "7",
  adId: null,
});

const dec = (
  key: string,
  action: CampaignDecision["action"],
  spend: number,
  real: number,
  patch: Partial<CampaignDecision> = {},
): CampaignDecision => ({
  key,
  platform: "meta",
  accountId: "1",
  campaignId: key.replace(/\D/g, "") || "9",
  accountLabel: "CR4",
  name: `CBO ${key}`,
  type: "CBO",
  product: "Gomitas",
  productKey: "family:gomitas",
  currency: "USD",
  dailyBudget: 50,
  suggestedBudget: action === "escalar" ? 60 : action === "bajar" ? 40 : null,
  action,
  label: DECISION_LABEL[action],
  detail: "detalle",
  window: {
    spendUsd: spend,
    real,
    utm: real,
    cpaReal: real > 0 ? spend / real : null,
    cpaPixel: null,
    partial: false,
  },
  approximate: false,
  level: "campaign",
  levelNote: null,
  todayAlert: null,
  learning: null,
  done: null,
  ...patch,
});
const creative = (
  adId: string,
  spend: number,
  real: number,
  patch: Partial<CreativeDecision> = {},
): CreativeDecision => ({
  key: `meta:1:${adId}`,
  platform: "meta",
  accountId: "1",
  campaignId: "55",
  accountLabel: "CR4",
  campaignName: "CBO GOMITAS | CR",
  adId,
  adName: `Video ${adId}`,
  postId: `100200_${adId}`,
  product: "Gomitas",
  productKey: "family:gomitas",
  spendUsd: spend,
  real,
  cpaReal: spend / real,
  basis: "estimado",
  done: null,
  ...patch,
});

describe("impacto de la cola (USD de 3 días)", () => {
  it("apagar y bajar: gasto sobre la meta; escalar y COST CAP: pedidos extra × CPA meta", () => {
    // 120 − 10 × 8,5 = 35.
    expect(queueImpact("apagar", { spendUsd: 120, real: 10 })).toBeCloseTo(35);
    // Without orders, the whole spend is over the target.
    expect(queueImpact("apagar", { spendUsd: 40, real: 0 })).toBe(40);
    expect(queueImpact("bajar", { spendUsd: 95, real: 10 })).toBeCloseTo(10);
    // 10 orders × 20 % × 8,5 = 17.
    expect(queueImpact("escalar", { spendUsd: 70, real: 10 })).toBeCloseTo(17);
    expect(queueImpact("costcap", { spendUsd: 30, real: 6 })).toBeCloseTo(10.2);
    expect(queueImpact("aprendizaje", { spendUsd: 70, real: 10 })).toBe(0);
  });

  it("ordena por impacto: pendientes, luego sin acción hoy y al final lo hecho", () => {
    const queue = buildActionQueue({
      campaigns: [
        dec("e1", "escalar", 70, 10), // 17
        dec("b2", "bajar", 95, 10), // 10
        dec("a3", "apagar", 120, 10), // 35
        dec("e4", "escalar", 200, 30), // 51
        dec("a5", "apagar", 17, 0), // 17 (tie with e1: apagar first)
        dec("l6", "aprendizaje", 60, 10, {
          learning: { at: now.toISOString(), kind: "presupuesto" },
        }),
        dec("m7", "mantener", 30, 4, { todayAlert: "Hoy: CPA real USD 12,00." }),
        dec("m8", "mantener", 30, 4),
        dec("b9", "bajar", 300, 30, { done: mark("bajar") }), // 45, but done
        dec("s10", "sin_datos", 0, 0),
      ],
      creatives: [creative("21", 30, 6)], // 10,2
    });
    expect(queue.map((i) => [i.key, i.kind])).toEqual([
      ["e4", "escalar"],
      ["a3", "apagar"],
      ["a5", "apagar"],
      ["e1", "escalar"],
      ["costcap:meta:1:21", "costcap"],
      ["b2", "bajar"],
      ["l6", "aprendizaje"],
      ["m7", "vigilar"],
      ["b9", "bajar"],
    ]);
    expect(plain(queue[1].impactText)).toBe("≈ USD 35 sobre la meta");
    expect(plain(queue[0].impactText)).toBe("≈ +6 pedidos");
    expect(queue.find((i) => i.key === "l6")!.learningUntil).toBe(
      "2026-11-16T20:35:00.000Z",
    );
  });

  it("un escalado hecho que ya entró en aprendizaje sigue como escalar hecho", () => {
    const [item] = buildActionQueue({
      campaigns: [
        dec("e1", "aprendizaje", 70, 10, {
          learning: { at: mark("escalar").at, kind: "presupuesto" },
          done: mark("escalar"),
        }),
      ],
      creatives: null,
    });
    expect(item).toMatchObject({ kind: "escalar", actionable: true });
    expect(item.done?.action).toBe("escalar");
    expect(item.learningUntil).not.toBeNull();
  });

  it("keeps rows marked in this session in place", () => {
    const campaigns = [
      dec("e1", "escalar", 70, 10, { done: mark("escalar") }),
      dec("b2", "bajar", 95, 10),
    ];
    expect(buildActionQueue({ campaigns, creatives: null }).map((i) => i.key)).toEqual(["b2", "e1"]);
    expect(
      buildActionQueue({
        campaigns,
        creatives: null,
        keepInPlace: new Set(["e1"]),
      }).map((i) => i.key),
    ).toEqual(["e1", "b2"]);
  });
});

describe("filtros de la cola", () => {
  const queue = buildActionQueue({
    campaigns: [
      dec("e1", "escalar", 70, 10, { todayAlert: "Hoy: USD 25,00 sin pedidos reales." }),
      dec("e2", "escalar", 70, 10, { done: mark("escalar") }),
      dec("b3", "bajar", 95, 10),
      dec("a4", "apagar", 120, 10),
      dec("a5", "apagar", 40, 0, { done: mark("apagar") }),
      dec("l6", "aprendizaje", 60, 10),
      dec("m7", "mantener", 30, 4, { todayAlert: "Hoy: CPA real USD 12,00." }),
    ],
    creatives: [creative("21", 30, 6), creative("22", 30, 7, { done: mark("costcap") })],
  });

  it("cuenta lo pendiente por acción, como los contadores del Resumen", () => {
    expect(queueCounts(queue)).toEqual({
      todas: 4, // e1, b3, a4, costcap 21
      escalar: 1,
      bajar: 1,
      apagar: 1,
      costcap: 1,
      aprendizaje: 1,
      alertas: 2,
    });
  });

  it("filtra por una acción o por la unión que pide el Resumen", () => {
    const keys = (items: QueueItem[]) => items.map((i) => i.key).sort();
    expect(filterQueue(queue, ["todas"])).toHaveLength(queue.length);
    expect(filterQueue(queue, [])).toHaveLength(queue.length);
    expect(keys(filterQueue(queue, ["escalar"]))).toEqual(["e1", "e2"]);
    expect(keys(filterQueue(queue, ["bajar", "apagar"]))).toEqual(["a4", "a5", "b3"]);
    expect(keys(filterQueue(queue, ["alertas"]))).toEqual(["e1", "m7"]);
    expect(filterQueue(queue, ["costcap"])).toHaveLength(2);
  });

  it("las anclas del Resumen abren su filtro", () => {
    expect(filterFromAnchor("decisiones-escalar")).toEqual(["escalar"]);
    expect(filterFromAnchor("decisiones-bajar")).toEqual(["bajar", "apagar"]);
    expect(filterFromAnchor("decisiones-costcap")).toEqual(["costcap"]);
    expect(filterFromAnchor("otra")).toBeNull();
    expect(filterFromAnchor(null)).toBeNull();
  });
});

describe("Hecho (registro manual de cambios)", () => {
  const [escalar] = buildActionQueue({
    campaigns: [dec("e123", "escalar", 70, 10)],
    creatives: null,
  });
  const [bajarTikTok] = buildActionQueue({
    campaigns: [
      dec("b456", "bajar", 95, 10, {
        platform: "tiktok",
        dailyBudget: null,
        suggestedBudget: null,
        productKey: "x",
      }),
    ],
    creatives: null,
  });
  const [costcap] = buildActionQueue({
    campaigns: [],
    creatives: [creative("987", 30, 6)],
  });

  it("guarda presupuesto con el monto, estado al apagar y creativo al pasar a COST CAP", () => {
    expect(plain(markDonePayload(escalar, now))).toEqual({
      platform: "meta",
      account_id: "1",
      campaign_id: "123",
      campaign_name: "CBO e123",
      product_key: "family:gomitas",
      kind: "presupuesto",
      detail: "Hecho en Acciones (escalar): Escalar +20 % · USD 50 → USD 60",
      changed_at: now.toISOString(),
    });
    expect(plain(markDonePayload(bajarTikTok, now))).toMatchObject({
      platform: "tiktok",
      kind: "presupuesto",
      // Product keys shorter than the route accepts are sent as null.
      product_key: null,
      detail: "Hecho en Acciones (bajar): Bajar −20 %",
    });
    const [apagar] = buildActionQueue({
      campaigns: [dec("a1", "apagar", 40, 0)],
      creatives: null,
    });
    expect(markDonePayload(apagar, now).kind).toBe("estado");
    expect(markDonePayload(costcap, now)).toMatchObject({
      campaign_id: "55",
      campaign_name: "CBO GOMITAS | CR",
      kind: "creativo",
      detail: "Hecho en Acciones (costcap:987): Pasar a COST CAP · post 100200_987 · anuncio Video 987",
    });
  });

  it("the saved entry reads back as the mark that feeds the learning guard", () => {
    const body = markDonePayload(escalar, now);
    const saved: CampaignChange = {
      platform: "meta",
      accountId: String(body.account_id),
      campaignId: String(body.campaign_id),
      at: String(body.changed_at),
      kind: body.kind as CampaignChange["kind"],
      detail: String(body.detail),
      source: "manual",
      id: "41",
      by: "Ana",
    };
    expect(parseDoneMark(saved)).toMatchObject({
      action: "escalar",
      at: now.toISOString(),
      id: "41",
    });
    const [creativeBody] = [markDonePayload(costcap, now)];
    expect(
      parseDoneMark({ ...saved, detail: String(creativeBody.detail) })?.adId,
    ).toBe("987");
  });

  it("solo editores, con el registro disponible, en una acción pendiente", () => {
    const ok = { canEdit: true, changesReady: true };
    expect(canMarkDone(escalar, ok)).toBe(true);
    expect(canMarkDone(escalar, { ...ok, canEdit: false })).toBe(false);
    expect(canMarkDone(escalar, { ...ok, changesReady: false })).toBe(false);
    expect(canMarkDone({ ...escalar, done: mark("escalar") }, ok)).toBe(false);
    const [learning] = buildActionQueue({
      campaigns: [dec("l1", "aprendizaje", 60, 10)],
      creatives: null,
    });
    expect(canMarkDone(learning, ok)).toBe(false);
    expect(() => markDonePayload(learning, now)).toThrow();
  });

  it("dice hace cuánto se marcó", () => {
    const ago = (minutes: number) =>
      agoText(new Date(now.getTime() - minutes * 60_000).toISOString(), now);
    expect(ago(0.5)).toBe("recién");
    expect(ago(5)).toBe("hace 5 min");
    expect(ago(125)).toBe("hace 2 h");
    expect(ago(60 * 50)).toBe("hace 2 d");
  });
});
