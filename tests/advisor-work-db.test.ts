import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDB: () => ({ from: mocks.from }) }));
import { readAdvisorWorkData } from "../lib/advisor-work-db";
function query(pages: Array<{ data: unknown[] | null; error: unknown }>) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "or", "order", "in"])
    q[name] = vi.fn(() => q);
  q.range = vi.fn(async () => pages.shift());
  return q;
}
beforeEach(() => vi.clearAllMocks());
describe("lectura acotada de atribucion de asesora", () => {
  it("pagina sin truncar y limita ambas fuentes a tienda y asesora; solo pide correlativo del payload", async () => {
    const events = query([{ data: [], error: null }]);
    const nativeRow = {
      icomfly_order_id: "1",
      order_number: "17933",
      shopify_display_number: "",
      tracking_number: "",
      confirmed_by_staff_id: 23,
      confirmed_by_name: "Rosa",
      confirmed_at: null,
      requested_by_staff_id: null,
      requested_by_name: "",
      requested_at: null,
    };
    const records = query([
      {
        data: Array.from({ length: 1000 }, (_, i) => ({
          ...nativeRow,
          icomfly_order_id: String(i),
        })),
        error: null,
      },
      { data: [{ ...nativeRow, icomfly_order_id: "1000" }], error: null },
    ]);
    const payload = query([]);
    payload.in.mockImplementation(async () => ({
      data: [{ icomfly_order_id: "0", web_seq: "7" }],
      error: null,
    }));
    mocks.from.mockImplementation((table: string) =>
      table === "order_events"
        ? events
        : table === "icomfly_orders"
          ? records
          : payload,
    );
    const result = await readAdvisorWorkData(1, 23);
    expect(result.native).toHaveLength(1001);
    expect(result.native[0].web_seq).toBe("7");
    expect(records.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(records.eq).toHaveBeenCalledWith("store_id", 1);
    expect(records.or).toHaveBeenCalledWith(
      "confirmed_by_staff_id.eq.23,requested_by_staff_id.eq.23",
    );
    expect(events.eq).toHaveBeenCalledWith("staff_id", 23);
    expect(payload.eq).toHaveBeenCalledWith("store_id", 1);
    expect(payload.in.mock.calls).toHaveLength(11);
    expect(payload.select).toHaveBeenCalledWith(
      "icomfly_order_id,web_seq:payload->>store_web_seq",
    );
    expect(records.select.mock.calls[0][0]).not.toMatch(
      /phone|customer|email|raw_attribution/,
    );
  });
  it("no sirve datos parciales si falla iComfly", async () => {
    const events = query([{ data: [], error: null }]),
      records = query([{ data: null, error: { message: "private" } }]);
    mocks.from.mockImplementation((t: string) =>
      t === "order_events" ? events : records,
    );
    await expect(readAdvisorWorkData(1, 23)).rejects.toThrow(
      "No se pudo consultar la atribución",
    );
  });
});
