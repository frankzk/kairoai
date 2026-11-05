// Etapa de venta según el estado de iComfly (tasa de confirmación de Gestión).
//
// POR QUE ESTE TEST EXISTE: la tasa de confirmación es confirmados ÷ generados,
// y "confirmado" sale del estado de hoy en iComfly. Si "Enviada" (mandado a
// Boxful sin guía) o "Guia_Generada" no cuentan como confirmados, la tasa cae;
// si "Pendiente" o "Modificar Dirección" cuentan, sube sin que nadie confirme.
import { describe, expect, it } from "vitest";
import { claveEstado, esEnviadaIcomfly, etapaVentaIcomfly } from "../lib/icomfly-estado-venta";

describe("etapa de venta en iComfly", () => {
  it("Confirmada y todo lo que viene después es confirmado", () => {
    for (const e of ["Confirmada", "Enviada", "Guia_Generada", "GUIA_GENERADA", "En_Transito", "En_Reparto", "Entregado", "Novedad", "NOVEDAD_OPERATIVA", "Devolucion", "Devolución", "Devuelto", "RECLAME_OFICINA", "Pedido Pagado"])
      expect(etapaVentaIcomfly(e), e).toBe("confirmado");
  });
  it("lo que la asesora todavía gestiona no es confirmado", () => {
    for (const e of ["Pendiente", "Comprar Después", "Modificar Dirección", "Modificar Pedido", "desea pago tarjeta", "quiere cordinar entrega con repartidor"])
      expect(etapaVentaIcomfly(e), e).toBe("en_gestion");
  });
  it("Testeos y Producto Agotado no cuentan; Cancelado es anulado; sin estado, null", () => {
    expect(etapaVentaIcomfly("Testeos")).toBe("no_cuenta");
    expect(etapaVentaIcomfly("Producto Agotado")).toBe("no_cuenta");
    expect(etapaVentaIcomfly("Cancelado")).toBe("anulado");
    expect(etapaVentaIcomfly("")).toBeNull();
    expect(etapaVentaIcomfly(null)).toBeNull();
  });
  it("normaliza tildes, mayúsculas y espacios", () => {
    expect(claveEstado("  Guía Generada ")).toBe("guia_generada");
    expect(esEnviadaIcomfly("Enviada")).toBe(true);
    expect(esEnviadaIcomfly("Confirmada")).toBe(false);
  });
});
