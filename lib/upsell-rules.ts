export interface UpsellRule {
  trigger_sku: string; // SKU del producto comprado
  trigger_name: string; // Nombre legible del trigger
  upsell_sku: string; // SKU del producto a ofrecer
  upsell_name: string; // Nombre del upsell
  upsell_price: number; // Precio en USD
  pitch: string; // Frase de venta del upsell (se inyecta al agente)
}

/**
 * Reglas de upsell para Mireva Costa Rica.
 * Se llenan con los productos reales del cliente.
 * El agente Valeria usa estas reglas para ofrecer productos complementarios
 * después de confirmar el pedido principal.
 */
export const MIREVA_CR_UPSELL_RULES: UpsellRule[] = [
  // Ejemplos de estructura — reemplazar con productos reales de Mireva CR:
  // {
  //   trigger_sku: "SHAMPOO-ROMERO-250",
  //   trigger_name: "Shampoo de Romero 250ml",
  //   upsell_sku: "SERUM-CAPILAR-50",
  //   upsell_name: "Sérum Capilar Potenciador",
  //   upsell_price: 18.99,
  //   pitch:
  //     "Muchos clientes que llevan el shampoo también agregan el sérum — juntos funcionan mejor y te ahorra el envío",
  // },
  // {
  //   trigger_sku: "CREMA-HIDRATANTE-100",
  //   trigger_name: "Crema Hidratante Facial 100ml",
  //   upsell_sku: "CONTORNO-OJOS-15",
  //   upsell_name: "Contorno de Ojos Antienvejecimiento",
  //   upsell_price: 22.5,
  //   pitch:
  //     "La crema y el contorno de ojos son el dúo perfecto — muchos de nuestros clientes los piden juntos para ver resultados más rápido",
  // },
];

/**
 * Finds the applicable upsell rule for a given list of SKUs.
 * Returns the first matching rule.
 */
export function findUpsellRule(skus: string[]): UpsellRule | null {
  for (const sku of skus) {
    const rule = MIREVA_CR_UPSELL_RULES.find(
      (r) => r.trigger_sku.toLowerCase() === sku.toLowerCase()
    );
    if (rule) return rule;
  }
  return null;
}

/**
 * Formats upsell rules as a readable string for injection into the system prompt.
 */
export function formatUpsellRulesForPrompt(rules: UpsellRule[]): string {
  if (!rules.length) return "No hay reglas de upsell configuradas por ahora.";
  return rules
    .map(
      (r) =>
        `- Si compró "${r.trigger_name}" (SKU: ${r.trigger_sku}), ofrecer "${r.upsell_name}" (SKU: ${r.upsell_sku}) a USD ${r.upsell_price}. Pitch: "${r.pitch}"`
    )
    .join("\n");
}
