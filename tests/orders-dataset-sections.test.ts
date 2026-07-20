import { describe, expect, it } from "vitest";

import {
  DATASET_SECTIONS,
  deserializeFullDataset,
  deserializeSection,
  pickSections,
  serializeFullDataset,
  serializeSection,
  type OrdersDataset,
  type SerializedFullDataset,
} from "../app/api/finance/_shared/orders-dataset-sections";
import type { SettlementTrace } from "../lib/finance-orders";

function sampleDataset(): OrdersDataset {
  const traces = new Map<string, SettlementTrace[]>([
    [
      "mcrc14065",
      [
        {
          file_name: "liq-01.xlsx",
          amount_to_liquidate: 12500,
          settlement_status: "settled",
          internal_status: "ok",
        } as SettlementTrace,
      ],
    ],
  ]);
  return {
    rows: [{ order_name: "#MCRC14065" } as unknown as OrdersDataset["rows"][number]],
    settlementTraceByKey: traces,
    shopifyOrders: [{ name: "#MCRC14065" } as unknown as OrdersDataset["shopifyOrders"][number]],
    matchedSettlementRows: [
      { guide_number: "G-1" } as unknown as OrdersDataset["matchedSettlementRows"][number],
    ],
    imports: [{ id: 1 } as unknown as OrdersDataset["imports"][number]],
    logisticsRows: [{ guide_number: "G-1" } as unknown as OrdersDataset["logisticsRows"][number]],
    liquidationAlertRows: [],
    doubleSettlementAnomalies: [],
  };
}

describe("orders dataset sections", () => {
  it("serializa settlementTraceByKey (Map) como entradas y lo reconstruye", () => {
    const data = sampleDataset();
    const serialized = serializeSection("settlementTraceByKey", data.settlementTraceByKey);

    // Sobrevive un round-trip por JSON (como viaja en JSONB)
    const json = JSON.parse(JSON.stringify(serialized));
    const restored = deserializeSection("settlementTraceByKey", json) as Map<
      string,
      SettlementTrace[]
    >;

    expect(restored).toBeInstanceOf(Map);
    expect(restored.get("mcrc14065")).toHaveLength(1);
    expect(restored.get("mcrc14065")![0].amount_to_liquidate).toBe(12500);
  });

  it("serializeFullDataset <-> deserializeFullDataset preserva todas las secciones", () => {
    const data = sampleDataset();
    const serialized = serializeFullDataset(data);

    // El Map no debe quedar como Map en el payload serializado
    expect(serialized.settlementTraceByKey).toBeInstanceOf(Array);

    const restored = deserializeFullDataset(
      JSON.parse(JSON.stringify(serialized)) as SerializedFullDataset
    );

    expect(restored.rows).toHaveLength(1);
    expect(restored.shopifyOrders).toHaveLength(1);
    expect(restored.matchedSettlementRows).toHaveLength(1);
    expect(restored.imports).toHaveLength(1);
    expect(restored.logisticsRows).toHaveLength(1);
    expect(restored.settlementTraceByKey.get("mcrc14065")).toHaveLength(1);
  });

  it("pickSections recorta solo las secciones pedidas", () => {
    const data = sampleDataset();
    const picked = pickSections(data, ["rows", "settlementTraceByKey"]);

    expect(Object.keys(picked).sort()).toEqual(["rows", "settlementTraceByKey"]);
    expect(picked.rows).toHaveLength(1);
    expect(picked.settlementTraceByKey.get("mcrc14065")).toHaveLength(1);
  });

  it("DATASET_SECTIONS cubre todas las llaves del dataset", () => {
    const data = sampleDataset();
    for (const key of Object.keys(data)) {
      expect(DATASET_SECTIONS).toContain(key);
    }
    expect(DATASET_SECTIONS).toHaveLength(Object.keys(data).length);
  });
});
