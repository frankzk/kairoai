import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  money,
  parseDate,
  parseLogisticsWorkbook,
  parseSettlementWorkbook,
} from "../lib/finance-import";

function makeWorkbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return wb;
}

const SETTLEMENT_HEADERS = [
  "No. Guia",
  "Orden",
  "No. Orden tienda",
  "Nombre",
  "Apellido",
  "Telefono",
  "Creado en",
  "Courier",
  "Tipo de Servicio",
  "Monto COD",
  "Monto de comision COD",
  "Com. Tarjeta",
  "Costo de entrega",
  "Pick&Pack",
  "Empaque",
  "A Liquidar",
  "Estado",
];

describe("parseSettlementWorkbook (Boxful)", () => {
  it("parsea la hoja Envios y el Consolidado", () => {
    const wb = makeWorkbook({
      Envios: [
        SETTLEMENT_HEADERS,
        [
          "FD123",
          "#MCRC1",
          "1001",
          "Juan",
          "Perez",
          "88887777",
          "01/02/2026",
          "Forza",
          "Standard",
          "10,000.50",
          "500",
          "0",
          "1,200",
          "300",
          "200",
          "8,000",
          "Entregado",
        ],
        // Fila sin guia ni orden: se descarta.
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ],
      Consolidado: [
        ["Total colectado", 100000],
        ["Total a recibir", 80000],
      ],
    });

    const { format, rows, consolidated } = parseSettlementWorkbook(wb);
    expect(format).toBe("boxful");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guide_number: "FD123",
      order_name: "#MCRC1",
      store_order_number: "1001",
      customer_name: "Juan Perez",
      first_name: "Juan",
      last_name: "Perez",
      courier: "Forza",
      cod_amount: 10000.5,
      cod_commission: 500,
      delivery_cost: 1200,
      pick_pack_cost: 300,
      packaging_cost: 200,
      amount_to_liquidate: 8000,
      settlement_status: "Entregado",
      internal_status: "delivered",
    });
    expect(rows[0].created_on).toBe("2026-02-01");
    expect(consolidated).toEqual({ total_collected: 100000, total_to_liquidate: 80000 });
  });

  it("mapea 'No entregado' a not_delivered", () => {
    const wb = makeWorkbook({
      Envios: [SETTLEMENT_HEADERS, ["FD9", "#MCRC9", "", "", "", "", "", "", "", "0", "0", "0", "0", "0", "0", "-500", "No entregado"]],
    });
    const { rows } = parseSettlementWorkbook(wb);
    expect(rows[0].internal_status).toBe("not_delivered");
    expect(rows[0].amount_to_liquidate).toBe(-500);
  });

  it("lanza error claro si el formato no se reconoce", () => {
    const wb = makeWorkbook({ Hoja1: [["Foo", "Bar"], ["a", "b"]] });
    expect(() => parseSettlementWorkbook(wb)).toThrow(/no reconocido/i);
  });
});

describe("parseLogisticsWorkbook (Boxful)", () => {
  it("parsea filas y paquetes", () => {
    const wb = makeWorkbook({
      Hoja1: [
        ["No. Guia", "Orden", "Nombre", "Apellido", "Courier", "Estado", "Paquete 1", "Cantidad Paquete 1", "Precio Paquete 1"],
        ["G1", "#MCRC2", "Ana", "Lopez", "Moovin", "Entregado", "Camisa", "2", "5,000"],
      ],
    });
    const { format, rows } = parseLogisticsWorkbook(wb);
    expect(format).toBe("boxful");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      guide_number: "G1",
      order_name: "#MCRC2",
      customer_name: "Ana Lopez",
      courier: "Moovin",
      boxful_status: "Entregado",
    });
    expect(rows[0].package_items).toEqual([{ title: "Camisa", quantity: 2, price: 5000 }]);
  });

  it("lanza error claro si el formato no se reconoce", () => {
    const wb = makeWorkbook({ Hoja1: [["Foo", "Bar"], ["a", "b"]] });
    expect(() => parseLogisticsWorkbook(wb)).toThrow(/no reconocido/i);
  });
});

describe("cell helpers", () => {
  it("money limpia separadores y simbolos", () => {
    expect(money("10,000.50")).toBe(10000.5);
    expect(money("₱1,234")).toBe(1234);
    expect(money("-")).toBe(0);
    expect(money("")).toBe(0);
    expect(money(5000)).toBe(5000);
  });

  it("parseDate normaliza dd/mm/yyyy e ISO, y maneja vacios", () => {
    expect(parseDate("01/02/2026")).toBe("2026-02-01");
    expect(parseDate("2026-02-01")).toBe("2026-02-01");
    expect(parseDate("-")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});
