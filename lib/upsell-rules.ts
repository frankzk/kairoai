// lib/upsell-rules.ts
// Mireva Costa Rica — Reglas de upsell basadas en data real de Easysell (últimos 30 días)
// Precios en Colones (₡), calculados como revenue ÷ pedidos

export interface UpsellRule {
  trigger_sku: string;
  upsell_sku: string;
  upsell_name: string;
  upsell_price: number; // ₡ Colones
  pitch: string;
  tier: "S" | "A" | "B"; // Tasa de conversión: S >20%, A 10-20%, B 5-10%
}

// Rules ordered by tier (S → A → B) so findUpsellRule returns the best match first
export const MIREVA_CR_UPSELL_RULES: UpsellRule[] = [
  // ============================================================
  // TIER S — Conversión >20%
  // ============================================================
  {
    trigger_sku: "shilajit-capsulas",
    upsell_sku: "turkesterone",
    upsell_name: "Turkesterone",
    upsell_price: 16069, // ₡1,510,500 ÷ 94
    pitch:
      "El stack #1 para hombres — Turkesterone + Shilajit maximiza tu testosterona y rendimiento natural.",
    tier: "S",
  },
  {
    trigger_sku: "turkesterone",
    upsell_sku: "shilajit-capsulas",
    upsell_name: "Shilajit en Cápsulas",
    upsell_price: 15900, // ₡318,000 ÷ 20
    pitch:
      "Potenciá el Turkesterone con Shilajit — más energía, más fuerza, absorción superior.",
    tier: "S",
  },
  {
    trigger_sku: "shampoo-romero",
    upsell_sku: "crema-peinar-romero",
    upsell_name: "Crema para Peinar de Romero",
    upsell_price: 7900, // ₡213,300 ÷ 27
    pitch:
      "Completá tu rutina capilar — la crema de romero sella la hidratación y activa el crecimiento todo el día.",
    tier: "S",
  },

  // ============================================================
  // TIER A — Conversión 10-20%
  // ============================================================
  {
    trigger_sku: "crema-depilatoria",
    upsell_sku: "iluminador-ushas",
    upsell_name: "Iluminador Corporal USHAS",
    upsell_price: 4900, // ₡39,200 ÷ 8
    pitch:
      "Piel suave + glow — después de depilar, el iluminador te deja con un brillo espectacular.",
    tier: "A",
  },
  {
    trigger_sku: "truly",
    upsell_sku: "creatina",
    upsell_name: "Creatina",
    upsell_price: 15722, // ₡723,200 ÷ 46
    pitch:
      "Cuidá tu piel por fuera y tonificá por dentro — Creatina para fuerza y definición muscular.",
    tier: "A",
  },
  {
    trigger_sku: "uro-probioticos",
    upsell_sku: "truly",
    upsell_name: "TRULY Soft Serve After Shave Oil",
    upsell_price: 14995, // ₡1,259,600 ÷ 84
    pitch:
      "Cuidado íntimo completo — URO por dentro, TRULY por fuera. Piel suave sin irritación.",
    tier: "A",
  },
  {
    trigger_sku: "camara-seguridad",
    upsell_sku: "alfombra-antideslizante",
    upsell_name: "Alfombra Súper Absorbente Antideslizante",
    upsell_price: 11550, // ₡69,300 ÷ 6
    pitch:
      "Ya protegés tu hogar con la cámara — completá con la alfombra absorbente que todos aman.",
    tier: "A",
  },
  {
    trigger_sku: "nad-resveratrol",
    upsell_sku: "yerba-magic",
    upsell_name: "Yerba Magic",
    upsell_price: 10900, // ₡21,800 ÷ 2
    pitch:
      "NAD rejuvenece tus células, Yerba Magic desintoxica tu cuerpo — anti-aging de adentro hacia afuera.",
    tier: "A",
  },
  {
    trigger_sku: "bulby-lampara",
    upsell_sku: "foco-camara-360",
    upsell_name: "Foco Cámara 360°",
    upsell_price: 11775, // ₡94,200 ÷ 8
    pitch:
      "Te gusta la tecnología inteligente — este foco es también cámara 360° con WiFi. Iluminá y vigilá.",
    tier: "A",
  },
  {
    trigger_sku: "truly",
    upsell_sku: "crema-aclaradora-bioaqua",
    upsell_name: "Crema Aclaradora Bioaqua",
    upsell_price: 11900, // ₡11,900 ÷ 1
    pitch:
      "Llevá tu cuidado al siguiente nivel — la crema aclaradora Bioaqua uniformiza y suaviza tu piel.",
    tier: "A",
  },

  // ============================================================
  // TIER B — Conversión 5-10%
  // ============================================================
  {
    trigger_sku: "truly",
    upsell_sku: "nad-resveratrol",
    upsell_name: "NAD + Resveratrol",
    upsell_price: 14159, // ₡382,300 ÷ 27
    pitch:
      "Cuidado externo + rejuvenecimiento celular — NAD + Resveratrol es el anti-aging que trabaja desde dentro.",
    tier: "B",
  },
  {
    trigger_sku: "magneticlash",
    upsell_sku: "crema-aclaradora-bioaqua",
    upsell_name: "Crema Aclaradora Bioaqua",
    upsell_price: 9900, // ₡19,800 ÷ 2
    pitch:
      "Ojos perfectos + piel radiante — la crema Bioaqua complementa tu look con un tono uniforme.",
    tier: "B",
  },
  {
    trigger_sku: "yerba-magic",
    upsell_sku: "lemme-burn",
    upsell_name: "Lemme Burn",
    upsell_price: 11900, // ₡23,800 ÷ 2
    pitch:
      "Desintoxicá con Yerba Magic y acelerá la quema de grasa con Lemme Burn — combo detox + fat burn.",
    tier: "B",
  },
];

// Named alias used in the original data
export const upsellRules = MIREVA_CR_UPSELL_RULES;

/**
 * Returns the best matching upsell rule for the given SKUs.
 * Prefers higher tiers (S > A > B). Returns null if no match.
 */
export function findUpsellRule(skus: string[]): UpsellRule | null {
  const tierOrder: Record<UpsellRule["tier"], number> = { S: 0, A: 1, B: 2 };
  let best: UpsellRule | null = null;

  for (const sku of skus) {
    const match = MIREVA_CR_UPSELL_RULES.find(
      (r) => r.trigger_sku.toLowerCase() === sku.toLowerCase()
    );
    if (
      match &&
      (best === null || tierOrder[match.tier] < tierOrder[best.tier])
    ) {
      best = match;
    }
  }
  return best;
}

/**
 * Formats upsell rules as a readable prompt block for Valeria.
 * Groups by tier so the agent prioritizes Tier S first.
 */
export function formatUpsellRulesForPrompt(rules: UpsellRule[]): string {
  if (!rules.length) return "No hay reglas de upsell configuradas por ahora.";

  const byTier: Record<string, UpsellRule[]> = { S: [], A: [], B: [] };
  for (const r of rules) byTier[r.tier].push(r);

  const tierLabel: Record<string, string> = {
    S: "ALTA conversión (>20%)",
    A: "MEDIA conversión (10-20%)",
    B: "BUENA conversión (5-10%)",
  };

  return (["S", "A", "B"] as const)
    .filter((t) => byTier[t].length > 0)
    .map(
      (t) =>
        `### Tier ${t} — ${tierLabel[t]}\n` +
        byTier[t]
          .map(
            (r) =>
              `- Si compró SKU "${r.trigger_sku}", ofrecer "${r.upsell_name}" (SKU: ${r.upsell_sku}) a ₡${r.upsell_price.toLocaleString("es-CR")}. Pitch: "${r.pitch}"`
          )
          .join("\n")
    )
    .join("\n\n");
}
