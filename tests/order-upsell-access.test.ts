import { describe, expect, it } from "vitest";
import { canManageOrderUpsell } from "../lib/order-upsell-access";
import { PERMISOS } from "../lib/permisos";

describe("acceso al upsell en el modelo de permisos publicado", () => {
  it("exige gestión y creación, y bloquea solo lectura", () => {
    expect(canManageOrderUpsell([])).toBe(false);
    expect(canManageOrderUpsell(["pedidos"])).toBe(false);
    expect(canManageOrderUpsell(["leads"])).toBe(false);
    const granted = (PERMISOS as readonly string[]).includes("pedidos_anular")
      ? ["pedidos", "pedidos_anular", "leads_crear_pedido"] : ["pedidos", "leads"];
    expect(canManageOrderUpsell(granted)).toBe(true);
    expect(canManageOrderUpsell([...granted, "solo_lectura"])).toBe(false);
  });
});
