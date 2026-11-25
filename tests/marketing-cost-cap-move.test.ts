// "Pasar a COST CAP" con un botón: la parte pura (destino, conjunto,
// duplicados, nombre, auditoría y motivos de error). Nada de esto toca Meta.
import { describe, expect, it } from "vitest";
import {
  buildMovePreview,
  costCapHint,
  costCapReadyAds,
  isCostCapCampaign,
  isMoveClaim,
  metaMoveAd,
  metaMoveAdset,
  metaMoveCampaign,
  metaWriteFailure,
  MOVE_TEXT,
  moveCandidates,
  moveClaimDetail,
  moveDoneDetail,
  moveMarker,
  moveProduct,
  newAdName,
  sameProduct,
  validateMoveTarget,
  type MoveAccount,
  type MoveAd,
  type MoveAdset,
  type MoveCampaign,
  type MoveProduct,
} from "../lib/marketing-cost-cap-move";
import { DONE_PREFIX, parseDoneMark } from "../lib/marketing-decisions";
import type { CampaignActionRow, Window } from "../lib/marketing-actions";
import type { MarketingFamily } from "../lib/marketing-product-families";
import type { CampaignProduct } from "../lib/marketing-settings-types";

const families: MarketingFamily[] = [
  {
    key: "family:batana",
    name: "Batana Oil",
    source: "shopify",
    review: false,
    members: [
      { key: "sku:bat-1", sku: "BAT-1", name: "Batana Oil 1 frasco" },
      { key: "sku:bat-2", sku: "BAT-2", name: "Batana Oil 2 frascos" },
    ],
  },
  {
    key: "family:lure",
    name: "Lure Her Perfume",
    source: "shopify",
    review: false,
    members: [{ key: "sku:lure-1", sku: "LURE-1", name: "Lure Her" }],
  },
];
const mapping = (patch: Partial<CampaignProduct> = {}): CampaignProduct => ({
  platform: "meta",
  account_id: "111",
  campaign_id: "1",
  product_key: "family:batana",
  product_name: "Batana Oil",
  sku: "",
  family_key: "family:batana",
  variant_scope: "all",
  variant_keys: [],
  ...patch,
});

const batana: MoveProduct = moveProduct(mapping(), families)!;
const lure: MoveProduct = moveProduct(
  mapping({
    product_key: "family:lure",
    product_name: "Lure Her Perfume",
    family_key: "family:lure",
  }),
  families,
)!;

const account = (
  id: string,
  patch: Partial<MoveAccount> = {},
): MoveAccount => ({
  id,
  name: `Cuenta ${id}`,
  currency: "USD",
  active: true,
  ...patch,
});
const campaign = (
  accountId: string,
  id: string,
  name: string,
  patch: Partial<MoveCampaign> = {},
): MoveCampaign => ({
  accountId,
  id,
  name,
  effectiveStatus: "ACTIVE",
  bidStrategy: null,
  ...patch,
});
const ad = (patch: Partial<MoveAd> = {}): MoveAd => ({
  id: "900",
  name: "VIDEO 03 | Testimonio",
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  adsetId: "50",
  campaignId: "10",
  creativeId: "700",
  postId: "100200_300400",
  urlTags: null,
  ...patch,
});
const adset = (
  id: string,
  campaignId: string,
  patch: Partial<MoveAdset> = {},
): MoveAdset => ({
  id,
  name: `Conjunto ${id}`,
  campaignId,
  effectiveStatus: "ACTIVE",
  bidAmount: 6,
  bidStrategy: "COST_CAP",
  dailyBudget: 50,
  optimizationGoal: "OFFSITE_CONVERSIONS",
  ...patch,
});

const CBO = campaign("111", "10", "CBO BATANA OIL | CR");
const CAP = campaign("111", "20", "COST CAP BATANA OIL | CR");
const CAP_OTHER = campaign("222", "30", "COST CAP BATANA OIL | CR4");
/** Producto por nombre de campaña, como lo resolvería la asignación. */
const productOf = (c: MoveCampaign) =>
  /BATANA/i.test(c.name) ? batana : /LURE/i.test(c.name) ? lure : null;
const WINDOW = { from: "2026-11-22", to: "2026-11-24" };

describe("producto y tipo de campaña", () => {
  it("el producto sale de la asignación de Marketing; sin asignación no hay producto", () => {
    expect(batana).toEqual({
      key: "family:batana",
      name: "Batana Oil",
      familyKey: "family:batana",
      members: ["sku:bat-1", "sku:bat-2"],
    });
    expect(moveProduct(null, families)).toBeNull();
    expect(
      moveProduct(mapping({ variant_scope: "none" }), families),
    ).toBeNull();
  });

  it("mismo producto = comparten variante; sin variantes, la misma clave o familia", () => {
    expect(sameProduct(batana, batana)).toBe(true);
    expect(sameProduct(batana, lure)).toBe(false);
    // Una variante elegida de la misma familia sigue siendo el mismo producto.
    const oneVariant = moveProduct(
      mapping({
        product_key: "sku:bat-2",
        variant_scope: "selected",
        variant_keys: ["sku:bat-2"],
      }),
      families,
    );
    expect(sameProduct(batana, oneVariant)).toBe(true);
    // Asignación vieja (solo la clave del producto) contra la familia.
    const legacy = moveProduct(
      mapping({
        product_key: "sku:bat-1",
        family_key: null,
        variant_scope: "legacy",
      }),
      families,
    );
    expect(sameProduct(legacy, batana)).toBe(true);
    // Catálogo sin leer: no hay variantes, deciden las claves.
    const blind = moveProduct(mapping(), []);
    expect(blind?.members).toEqual([]);
    expect(sameProduct(blind, batana)).toBe(true);
    expect(sameProduct(blind, lure)).toBe(false);
    expect(sameProduct(null, batana)).toBe(false);
  });

  it("reconoce una COST CAP como el control de las COST CAP (nombre o estrategia)", () => {
    for (const name of [
      "COST CAP BATANA OIL | CR",
      "COST CAP Lure Her Perfume 1210 | CR",
      "COST_CAP_SELERB NAD",
      "cost-cap gomitas",
    ])
      expect(isCostCapCampaign({ name }), name).toBe(true);
    expect(
      isCostCapCampaign({ name: "CBO BATANA", bidStrategy: "COST_CAP" }),
    ).toBe(true);
    expect(isCostCapCampaign({ name: "CBO BATANA OIL | CR" })).toBe(false);
    expect(
      isCostCapCampaign({
        name: "ABO BATANA",
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      }),
    ).toBe(false);
  });
});

describe("lo que se lee de Meta", () => {
  it("normaliza campaña, conjunto y anuncio; descarta lo que no trae id", () => {
    expect(
      metaMoveCampaign(
        {
          id: "20",
          name: "COST CAP X",
          effective_status: "ACTIVE",
          bid_strategy: "COST_CAP",
        },
        "111",
      ),
    ).toEqual({
      accountId: "111",
      id: "20",
      name: "COST CAP X",
      effectiveStatus: "ACTIVE",
      bidStrategy: "COST_CAP",
    });
    expect(metaMoveCampaign({ id: "abc" }, "111")).toBeNull();
    // Montos en centavos (USD y CRC); un CBO no trae presupuesto en el conjunto.
    expect(
      metaMoveAdset(
        {
          id: "60",
          name: "Abierto",
          campaign_id: "20",
          effective_status: "ACTIVE",
          bid_amount: "650",
          bid_strategy: "COST_CAP",
          optimization_goal: "OFFSITE_CONVERSIONS",
        },
        "USD",
      ),
    ).toEqual({
      id: "60",
      name: "Abierto",
      campaignId: "20",
      effectiveStatus: "ACTIVE",
      bidAmount: 6.5,
      bidStrategy: "COST_CAP",
      dailyBudget: null,
      optimizationGoal: "OFFSITE_CONVERSIONS",
    });
    expect(
      metaMoveAdset(
        { id: "60", campaign_id: "20", bid_amount: 650, daily_budget: "5000" },
        "PEN",
      ),
    ).toMatchObject({ bidAmount: null, dailyBudget: null });
    expect(metaMoveAdset({ id: "60" }, "USD")).toBeNull();
    expect(
      metaMoveAd({
        id: "900",
        name: "Video",
        status: "ACTIVE",
        effective_status: "CAMPAIGN_PAUSED",
        adset_id: "50",
        campaign_id: "10",
        creative: {
          id: "700",
          effective_object_story_id: "100200_300400",
          url_tags: "utm_source=facebook&utm_campaign={{campaign.id}}",
        },
      }),
    ).toEqual({
      id: "900",
      name: "Video",
      status: "ACTIVE",
      effectiveStatus: "CAMPAIGN_PAUSED",
      adsetId: "50",
      campaignId: "10",
      creativeId: "700",
      postId: "100200_300400",
      urlTags: "utm_source=facebook&utm_campaign={{campaign.id}}",
    });
    // Sin publicación reutilizable (p. ej. creativo dinámico): postId null.
    expect(metaMoveAd({ id: "901", creative: { id: "701" } })).toMatchObject({
      postId: null,
      creativeId: "701",
      urlTags: null,
    });
    expect(
      metaMoveAd({
        id: "902",
        creative: { effective_object_story_id: "no-es-un-post" },
      })?.postId,
    ).toBeNull();
    expect(metaMoveAd({ name: "sin id" })).toBeNull();
  });
});

describe("destino: COST CAP activa del mismo producto en una cuenta activa", () => {
  const base = {
    source: ad(),
    sourceCampaign: CBO,
    accounts: [account("111"), account("222")],
    campaigns: [CBO, CAP, CAP_OTHER],
    productOf,
  };

  it("ofrece las COST CAP del mismo producto de todas las cuentas activas", () => {
    const out = moveCandidates(base);
    expect(out.blocked).toBeNull();
    expect(out.product?.name).toBe("Batana Oil");
    expect(out.candidates.map((c) => `${c.accountId}:${c.id}`)).toEqual([
      "111:20",
      "222:30",
    ]);
  });

  it("nunca ofrece una cuenta desactivada, una campaña pausada ni otro producto", () => {
    const out = moveCandidates({
      ...base,
      accounts: [account("111"), account("222", { active: false })],
      campaigns: [
        CBO,
        { ...CAP, effectiveStatus: "PAUSED" },
        CAP_OTHER,
        campaign("111", "40", "COST CAP Lure Her Perfume 1210 | CR"),
        campaign("111", "41", "CBO BATANA OIL 2 | CR"),
        // Cuenta que no se pudo leer: no está en `accounts`.
        campaign("333", "50", "COST CAP BATANA OIL | CR5"),
      ],
    });
    expect(out.candidates).toEqual([]);
    expect(out.blocked).toBe(MOVE_TEXT.noDestination);
    expect(out.product?.key).toBe("family:batana");
  });

  it("dice por qué no se puede antes de buscar destino", () => {
    expect(moveCandidates({ ...base, source: null }).blocked).toBe(
      MOVE_TEXT.noAd,
    );
    expect(moveCandidates({ ...base, sourceCampaign: null }).blocked).toBe(
      MOVE_TEXT.noAd,
    );
    // El anuncio dice otra campaña que la que se leyó.
    expect(
      moveCandidates({ ...base, source: ad({ campaignId: "99" }) }).blocked,
    ).toBe(MOVE_TEXT.noAd);
    expect(
      moveCandidates({
        ...base,
        source: ad({ campaignId: "20" }),
        sourceCampaign: CAP,
      }).blocked,
    ).toBe(MOVE_TEXT.alreadyCostCap);
    expect(
      moveCandidates({ ...base, source: ad({ postId: null }) }).blocked,
    ).toBe(MOVE_TEXT.noPost);
    expect(moveCandidates({ ...base, productOf: () => null }).blocked).toBe(
      MOVE_TEXT.noProduct,
    );
    // Una COST CAP sin producto asignado no es "del mismo producto".
    expect(
      moveCandidates({
        ...base,
        productOf: (c) => (c.id === "10" ? batana : null),
      }).blocked,
    ).toBe(MOVE_TEXT.noDestination);
  });
});

describe("vista previa: conjunto, duplicados y sugerencias", () => {
  const preview = (
    patch: Partial<Parameters<typeof buildMovePreview>[0]> = {},
  ) =>
    buildMovePreview({
      window: WINDOW,
      source: ad(),
      sourceCampaign: CBO,
      accounts: [account("111"), account("222", { name: "Arqui Nexo CR4" })],
      blocked: null,
      product: batana,
      candidates: [CAP],
      adsets: new Map([["111", [adset("60", "20")]]]),
      ads: new Map([["111", [] as MoveAd[]]]),
      spend: new Map(),
      ...patch,
    });

  it("un solo conjunto activo: se usa ese", () => {
    const out = preview({
      adsets: new Map([
        [
          "111",
          [
            adset("60", "20"),
            adset("61", "20", { effectiveStatus: "PAUSED" }),
            // De otra campaña: no cuenta.
            adset("62", "21"),
          ],
        ],
      ]),
    });
    expect(out.blocked).toBeNull();
    expect(out.source).toMatchObject({
      accountId: "111",
      accountName: "Cuenta 111",
      adId: "900",
      campaignName: "CBO BATANA OIL | CR",
      creativeId: "700",
      postId: "100200_300400",
      product: "Batana Oil",
    });
    expect(out.destinations).toHaveLength(1);
    expect(out.destinations[0]).toMatchObject({
      accountId: "111",
      sameAccount: true,
      campaignId: "20",
      campaignName: "COST CAP BATANA OIL | CR",
      suggestedAdsetId: "60",
      duplicate: null,
      blocked: null,
    });
    expect(out.destinations[0].adsets.map((s) => s.id)).toEqual(["60"]);
    expect(out.suggested).toEqual({
      accountId: "111",
      campaignId: "20",
      adsetId: "60",
    });
    expect(out.newAdName).toBe("VIDEO 03 | Testimonio");
  });

  it("varios conjuntos: se listan todos y se sugiere el de más gasto en la ventana", () => {
    const out = preview({
      adsets: new Map([
        [
          "111",
          [
            adset("60", "20", { name: "Abierto" }),
            adset("61", "20", { name: "Mujeres 25-45", bidAmount: 7 }),
            adset("62", "20", { name: "Lookalike" }),
          ],
        ],
      ]),
      spend: new Map([
        ["60", 40],
        ["61", 95.5],
      ]),
    });
    expect(out.destinations[0].adsets.map((s) => [s.id, s.spend])).toEqual([
      ["61", 95.5],
      ["60", 40],
      ["62", null],
    ]);
    expect(out.destinations[0].suggestedAdsetId).toBe("61");
    expect(out.destinations[0].spend).toBe(135.5);
    expect(out.suggested?.adsetId).toBe("61");
    // Sin lectura de gasto: el primero por nombre, sin inventar un orden.
    const blind = preview({
      adsets: new Map([
        [
          "111",
          [
            adset("61", "20", { name: "Mujeres" }),
            adset("60", "20", { name: "Abierto" }),
          ],
        ],
      ]),
      spend: null,
    });
    expect(blind.destinations[0].suggestedAdsetId).toBe("60");
    expect(blind.destinations[0].spend).toBeNull();
  });

  it("varios destinos: primero la cuenta del anuncio; si no, la de más gasto", () => {
    const both = preview({
      candidates: [CAP_OTHER, CAP],
      adsets: new Map([
        ["111", [adset("60", "20")]],
        ["222", [adset("70", "30")]],
      ]),
      ads: new Map([
        ["111", []],
        ["222", []],
      ]),
      spend: new Map([
        ["60", 10],
        ["70", 500],
      ]),
    });
    expect(
      both.destinations.map((d) => [d.accountId, d.accountName, d.sameAccount]),
    ).toEqual([
      ["111", "Cuenta 111", true],
      ["222", "Arqui Nexo CR4", false],
    ]);
    expect(both.suggested).toEqual({
      accountId: "111",
      campaignId: "20",
      adsetId: "60",
    });
    // Ninguna en la cuenta del anuncio: gana la de más gasto.
    const CAP_THIRD = campaign("333", "40", "COST CAP BATANA OIL | DC003");
    const away = preview({
      accounts: [account("111"), account("222"), account("333")],
      candidates: [CAP_OTHER, CAP_THIRD],
      adsets: new Map([
        ["222", [adset("70", "30")]],
        ["333", [adset("80", "40")]],
      ]),
      ads: new Map([
        ["222", []],
        ["333", []],
      ]),
      spend: new Map([
        ["70", 20],
        ["80", 300],
      ]),
    });
    expect(away.destinations.map((d) => d.accountId)).toEqual(["333", "222"]);
    expect(away.suggested).toEqual({
      accountId: "333",
      campaignId: "40",
      adsetId: "80",
    });
    // La de la cuenta del anuncio ya tiene la publicación: se sugiere la otra.
    const taken = preview({
      candidates: [CAP, CAP_OTHER],
      adsets: new Map([
        ["111", [adset("60", "20")]],
        ["222", [adset("70", "30")]],
      ]),
      ads: new Map([
        ["111", [ad({ id: "955", campaignId: "20", name: "Copia" })]],
        ["222", []],
      ]),
    });
    expect(taken.blocked).toBeNull();
    expect(taken.destinations[0]).toMatchObject({
      accountId: "111",
      blocked: MOVE_TEXT.duplicate,
      duplicate: { adId: "955", name: "Copia" },
    });
    expect(taken.suggested).toEqual({
      accountId: "222",
      campaignId: "30",
      adsetId: "70",
    });
  });

  it("la publicación ya está en la campaña: «Ya está en la COST CAP», sin destino", () => {
    const out = preview({
      ads: new Map([
        [
          "111",
          [
            ad({ id: "951", campaignId: "20", postId: "100200_999" }),
            // Mismo post en OTRA campaña: no es duplicado de esta.
            ad({ id: "952", campaignId: "21" }),
            ad({
              id: "953",
              campaignId: "20",
              name: "VIDEO 03 pausado",
              effectiveStatus: "PAUSED",
            }),
          ],
        ],
      ]),
    });
    expect(out.destinations[0].duplicate).toEqual({
      adId: "953",
      name: "VIDEO 03 pausado",
    });
    expect(out.destinations[0].blocked).toBe(MOVE_TEXT.duplicate);
    expect(out.blocked).toBe(MOVE_TEXT.duplicate);
    expect(out.suggested).toBeNull();
  });

  it("sin poder comprobar duplicados o sin conjunto activo, el destino queda bloqueado", () => {
    expect(preview({ ads: new Map([["111", null]]) }).blocked).toBe(
      MOVE_TEXT.duplicatesUnread,
    );
    expect(preview({ adsets: new Map([["111", null]]) }).blocked).toBe(
      MOVE_TEXT.adsetsUnread,
    );
    expect(
      preview({
        adsets: new Map([
          ["111", [adset("60", "20", { effectiveStatus: "PAUSED" })]],
        ]),
      }).blocked,
    ).toBe(MOVE_TEXT.noAdsets);
    // Lo que ya venía bloqueado se respeta; sin candidatos, "no tiene COST CAP".
    expect(
      preview({ blocked: MOVE_TEXT.noProduct, product: null, candidates: [] })
        .blocked,
    ).toBe(MOVE_TEXT.noProduct);
    expect(preview({ candidates: [] }).blocked).toBe(MOVE_TEXT.noDestination);
    expect(preview({ source: null, candidates: [] }).source).toBeNull();
  });

  it("valida la elección del POST contra la vista previa recién leída", () => {
    const out = preview({
      candidates: [CAP, CAP_OTHER],
      adsets: new Map([
        ["111", [adset("60", "20"), adset("61", "20")]],
        ["222", [adset("70", "30")]],
      ]),
      ads: new Map([
        ["111", []],
        ["222", [ad({ id: "960", campaignId: "30" })]],
      ]),
    });
    expect(
      validateMoveTarget(out, { targetAccount: "111", adset: "61" }),
    ).toMatchObject({
      ok: true,
      destination: { campaignId: "20" },
      adset: { id: "61" },
    });
    // Conjunto de otra cuenta, inexistente o de una campaña que no es COST CAP.
    for (const target of [
      { targetAccount: "222", adset: "61" },
      { targetAccount: "111", adset: "70" },
      { targetAccount: "111", adset: "50" },
      { targetAccount: "999", adset: "60" },
    ])
      expect(validateMoveTarget(out, target)).toEqual({
        ok: false,
        reason: MOVE_TEXT.badTarget,
        duplicate: false,
      });
    expect(
      validateMoveTarget(out, { targetAccount: "222", adset: "70" }),
    ).toEqual({
      ok: false,
      reason: MOVE_TEXT.duplicate,
      duplicate: true,
    });
    const none = preview({ candidates: [] });
    expect(
      validateMoveTarget(none, { targetAccount: "111", adset: "60" }),
    ).toMatchObject({
      ok: false,
      reason: MOVE_TEXT.noDestination,
    });
    const missing = preview({
      source: null,
      blocked: MOVE_TEXT.noAd,
      candidates: [],
    });
    expect(
      validateMoveTarget(missing, { targetAccount: "111", adset: "60" }),
    ).toMatchObject({
      ok: false,
      reason: MOVE_TEXT.noAd,
    });
  });
});

describe("nombre, auditoría y motivos", () => {
  it("el anuncio nuevo lleva el nombre del original", () => {
    expect(newAdName({ id: "900", name: "  VIDEO 03 |\n Testimonio  " })).toBe(
      "VIDEO 03 | Testimonio",
    );
    expect(newAdName({ id: "900", name: "x".repeat(400) })).toHaveLength(250);
    expect(newAdName({ id: "900", name: " " })).toBe("Anuncio 900");
  });

  it("la reserva y el «Hecho» comparten la marca de publicación + campaña y caben en 200", () => {
    const move = {
      adId: "120212345678901234",
      postId: "123456789012345_12345678901234567",
      campaignId: "120298765432109876",
      adsetId: "120211122233344455",
    };
    const marker = moveMarker(move.postId, move.campaignId);
    const claim = moveClaimDetail(move);
    expect(claim).toContain(marker);
    expect(isMoveClaim(claim)).toBe(true);
    expect(claim.startsWith(DONE_PREFIX)).toBe(false);
    expect(claim.length).toBeLessThanOrEqual(200);
    // La reserva NO cuenta como "Hecho".
    const change = (detail: string) => ({
      platform: "meta" as const,
      accountId: "111",
      campaignId: "10",
      at: "2026-11-25T18:00:00.000Z",
      kind: "creativo" as const,
      detail,
      source: "manual" as const,
      id: "5",
      by: "Ana",
    });
    expect(parseDoneMark(change(claim))).toBeNull();

    const done = moveDoneDetail({ ...move, newAdId: "120299999999999999" });
    expect(done).toBe(
      "Hecho en Acciones (costcap:120212345678901234): post 123456789012345_12345678901234567 · camp 120298765432109876 · conj 120211122233344455 · nuevo 120299999999999999",
    );
    expect(done).toContain(marker);
    expect(isMoveClaim(done)).toBe(false);
    expect(done.length).toBeLessThanOrEqual(200);
    expect(parseDoneMark(change(done))).toMatchObject({
      action: "costcap",
      adId: "120212345678901234",
      newAdId: "120299999999999999",
      by: "Ana",
      at: "2026-11-25T18:00:00.000Z",
    });
    // Otra cuenta: se anota si cabe; si no, se sacrifica antes que el anuncio nuevo.
    const away = moveDoneDetail({
      ...move,
      newAdId: "120299999999999999",
      targetAccount: "1234567890123456",
    });
    expect(away.length).toBeLessThanOrEqual(200);
    expect(parseDoneMark(change(away))?.newAdId).toBe("120299999999999999");
    expect(away.endsWith("· cuenta 1234567890123456")).toBe(true);
    const tight = moveDoneDetail({
      ...move,
      postId: "1234567890123456789_1234567890123456789",
      campaignId: "12029876543210987654321098",
      newAdId: "120299999999999999",
      targetAccount: "1234567890123456",
    });
    expect(tight.length).toBeLessThanOrEqual(200);
    expect(tight).not.toContain("cuenta");
    expect(parseDoneMark(change(tight))?.newAdId).toBe("120299999999999999");
  });

  it("traduce el fallo de Meta por su código, nunca por su texto", () => {
    const kind = (e: Parameters<typeof metaWriteFailure>[0]) =>
      metaWriteFailure(e).kind;
    expect(kind({ http: 400, code: 190 })).toBe("token");
    expect(kind({ http: 401 })).toBe("token");
    expect(kind({ http: 400, code: 200 })).toBe("permission");
    expect(kind({ http: 400, code: 10 })).toBe("permission");
    expect(kind({ http: 403 })).toBe("permission");
    expect(kind({ http: 400, code: 17 })).toBe("limit");
    expect(kind({ http: 400, code: 80004 })).toBe("limit");
    expect(kind({ http: 429 })).toBe("limit");
    expect(kind({ http: 500, code: 2 })).toBe("temporary");
    expect(kind({ http: 400, code: 100, transient: true })).toBe("temporary");
    // Sin respuesta (red, tiempo de espera): no se sabe si se creó.
    expect(kind({ http: 0 })).toBe("temporary");
    expect(kind({ http: 400, code: 100 })).toBe("rejected");
    expect(kind({ http: 400, code: 1487390 })).toBe("rejected");
    expect(metaWriteFailure({ http: 400, code: 200 }).reason).toMatch(
      /permiso de escritura/,
    );
    expect(metaWriteFailure({ http: 400, code: 100 }).reason).toMatch(
      /no acepta este anuncio/,
    );
    expect(metaWriteFailure({ http: 400, code: 17 }).reason).toMatch(
      /límite de la cuenta/,
    );
    expect(metaWriteFailure({ http: 500 }).reason).toMatch(/Error temporal/);
  });
});

/* ------------------------------------------------ Avisos en la pantalla */

const w = (spend = 0): Window => ({
  spendNative: spend,
  spendUsd: spend,
  pixel: 0,
  real: 0,
  utm: 0,
  partial: false,
  cpaReal: null,
  cpaPixel: null,
});
const row = (
  accountId: string,
  campaignId: string,
  name: string,
  patch: Partial<CampaignActionRow> = {},
): CampaignActionRow => ({
  key: `meta:${accountId}:${campaignId}`,
  platform: "meta",
  accountId,
  accountLabel: accountId === "111" ? "DC003" : `CR${accountId[0]}`,
  campaignId,
  name,
  type: /COST CAP/.test(name) ? "COST CAP" : "CBO",
  status: "activa",
  currency: "USD",
  dailyBudget: 50,
  bid: null,
  bidMixed: false,
  product: {
    key: "family:batana",
    name: "Batana Oil",
    automatic: true,
    reason: "",
  },
  coverage: null,
  restocked: null,
  restockedFromLow: null,
  stockStale: null,
  dataThrough: null,
  today: w(),
  yesterday: w(),
  days3: w(30),
  days7: w(),
  launch: {
    date: null,
    ageDays: null,
    lifetimeSpendNative: null,
    testSpend: null,
    lifetimeReal: null,
    lifetimePixel: null,
    inTest: false,
  },
  lastChange: null,
  lastStatusChange: null,
  changesStatus: "activity",
  action: { code: "mantener", label: "Mantener", tone: "info", detail: "" },
  notes: [],
  ...patch,
});

describe("aviso en Acciones: ¿el producto tiene COST CAP activa?", () => {
  const item = {
    platform: "meta" as const,
    accountId: "111",
    campaignId: "10",
  };
  const source = row("111", "10", "CBO BATANA OIL | CR");

  it("lista las COST CAP activas del mismo producto, también en otra cuenta que entrega", () => {
    const rows = [
      source,
      row("111", "20", "COST CAP BATANA OIL | CR"),
      row("222", "30", "COST CAP BATANA OIL | CR4"),
      row("111", "40", "COST CAP LURE | CR", {
        product: {
          key: "family:lure",
          name: "Lure",
          automatic: true,
          reason: "",
        },
      }),
      row("111", "41", "COST CAP BATANA VIEJA", { status: "pausada" }),
      row("111", "42", "CBO BATANA 2"),
    ];
    expect(costCapHint(item, rows, null)).toEqual([
      {
        accountId: "111",
        accountLabel: "DC003",
        campaignId: "20",
        name: "COST CAP BATANA OIL | CR",
      },
      {
        accountId: "222",
        accountLabel: "CR2",
        campaignId: "30",
        name: "COST CAP BATANA OIL | CR4",
      },
    ]);
    // Con las variantes cargadas decide la variante compartida, no la clave.
    const members = new Map([
      ["meta:111:10", ["sku:bat-1"]],
      ["meta:111:20", ["sku:bat-1", "sku:bat-2"]],
      ["meta:222:30", ["sku:otro"]],
    ]);
    expect(costCapHint(item, rows, members).map((d) => d.campaignId)).toEqual([
      "20",
    ]);
  });

  it("una cuenta sin gasto reciente (desactivada) no cuenta; sin producto o sin fila, nada", () => {
    const disabled = row("555", "60", "COST CAP BATANA OIL | CR5", {
      days3: w(0),
    });
    expect(costCapHint(item, [source, disabled], null)).toEqual([]);
    expect(
      costCapHint(
        item,
        [{ ...source, product: null }, row("111", "20", "COST CAP BATANA")],
        null,
      ),
    ).toEqual([]);
    expect(
      costCapHint(item, [row("111", "20", "COST CAP BATANA")], null),
    ).toEqual([]);
    expect(
      costCapHint(
        { ...item, platform: "tiktok" },
        [source, row("111", "20", "COST CAP BATANA")],
        null,
      ),
    ).toEqual([]);
  });
});

describe("marcador «Lista para COST CAP» de Publicidad", () => {
  const adRow = (
    id: string,
    purchases: number | null,
    spend: number | null,
    patch = {},
  ) => ({
    id,
    accountId: "111",
    status: "active",
    campaignName: "CBO BATANA OIL | CR",
    purchases,
    spend,
    ...patch,
  });

  it("misma regla de Acciones: activos, fuera de una COST CAP, 3 compras y menos de USD 7", () => {
    const ready = costCapReadyAds([
      adRow("1", 3, 20.9),
      adRow("2", 3, 21), // USD 7,00: no
      adRow("3", 2, 5), // 2 compras: no
      adRow("4", 8, 30, { status: "paused" }),
      adRow("5", 8, 30, { campaignName: "COST CAP BATANA OIL | CR" }),
      adRow("6", 8, null), // sin tipo de cambio
      adRow("7", null, 30),
      adRow("8", 5, 10, { accountId: "222", campaignName: undefined }),
    ]);
    expect(Array.from(ready).sort()).toEqual(["111:1", "222:8"]);
  });
});
