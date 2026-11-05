import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDB: () => ({ from: mock.from }) }));
import { readKairoConfirmationIndex } from "../lib/order-confirmations-db";
function setup(pages: Array<{ data: unknown; error: unknown }>) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of ["select", "eq", "order"]) q[k] = vi.fn(() => q);
  q.range = vi.fn(async () => pages.shift());
  mock.from.mockReturnValue(q);
  return q;
}
beforeEach(() => vi.clearAllMocks());
describe("lectura local de confirmaciones", () => {
  it("pagina todos los resultados dentro de la tienda y no lee notas ni datos del cliente", async () => {
    const event = {
      kind: "contacto",
      outcome: "confirmado",
      staff_id: 23,
      staff_name: "Rosa",
      created_at: "2026-11-04T12:00:00Z",
    };
    const q = setup([
      {
        data: Array.from({ length: 1000 }, (_, i) => ({
          ...event,
          order_name: "#MCRC" + i,
        })),
        error: null,
      },
      { data: [{ ...event, order_name: "#MCRC1000" }], error: null },
    ]);
    const index = await readKairoConfirmationIndex(1);
    expect(index.byActorAndOrder.size).toBe(1001);
    expect(q.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(q.eq).toHaveBeenCalledWith("store_id", 1);
    expect(q.eq).toHaveBeenCalledWith("kind", "contacto");
    expect(q.eq).toHaveBeenCalledWith("outcome", "confirmado");
    expect(q.select.mock.calls[0][0]).not.toMatch(
      /phone|customer|message|metadata|email/,
    );
  });
  it("no usa un resultado parcial tras fallar una página", async () => {
    setup([{ data: null, error: { message: "private" } }]);
    await expect(readKairoConfirmationIndex(2)).rejects.toThrow(
      "No se pudieron consultar",
    );
  });
});
