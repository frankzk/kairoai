import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductivityTable from "../components/ProductivityTable";
import { horaDeGestion, ListaLeadsDeAsesora, type RespuestaLeadsDeAsesora } from "../components/ProductivityLeadsModal";
import type { ConnectedProductivityRow } from "../lib/leads-productivity-presence";

const fila = (over: Partial<ConnectedProductivityRow>): ConnectedProductivityRow => ({
  user_id: 5, name: "Ana", staff_id: 24, vendedora_id: 24, gestiones: 30, leads: 25, pedidos: 2,
  last_activity_at: null, last_seen_at: null, active_until: null, connected_until: null, ...over,
});

describe("el numero de Leads en la tabla", () => {
  it("es un boton de verdad con aria-label cuando hay leads y se puede abrir la lista", () => {
    const html = renderToStaticMarkup(createElement(ProductivityTable, {
      rows: [fila({}), fila({ user_id: 6, name: "Bea", staff_id: 25, vendedora_id: 25, leads: 0 }), fila({ user_id: 7, name: "Sin planilla", staff_id: null, vendedora_id: null, leads: null })],
      totals: { gestiones: 60, leads: 25, pedidos: 4 }, now: 0, loading: false, stale: false, onVerLeads: () => {},
    }));
    expect(html).toContain('aria-label="Ver los 25 leads que gestionó Ana"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html.match(/<button/g)).toHaveLength(1); // Bea (0) y sin planilla no son boton
  });

  it("sin lista disponible (todavia sin periodo) el numero es solo texto", () => {
    const html = renderToStaticMarkup(createElement(ProductivityTable, {
      rows: [fila({})], totals: null, now: 0, loading: false, stale: false,
    }));
    expect(html).not.toContain("<button");
    expect(html).toContain(">25<");
  });
});

describe("la lista de leads de la asesora", () => {
  const data: RespuestaLeadsDeAsesora = {
    total: 2, gestiones: 3, incompleto: false, max_leads: 500,
    leads: [
      { lead_id: 7, gestiones: 2, pedidos: 1, primera: "2026-11-28T15:05:00.000Z", ultima: "2026-11-28T17:40:00.000Z", tipos: { sale: 1, state_change: 1 },
        lead: { id: 7, store_id: 1, phone: "50661234567", name: "María Pérez", status: "pedido_generado", labels: ["VIP"], has_order: true } },
      { lead_id: 8, gestiones: 1, pedidos: 0, primera: "2026-11-28T16:00:00.000Z", ultima: "2026-11-28T16:00:00.000Z", tipos: { note: 1 }, lead: null },
    ],
  };

  it("muestra nombre, telefono con formato, estado, horas en la zona de la tienda y lo que hizo", () => {
    const html = renderToStaticMarkup(createElement(ListaLeadsDeAsesora, {
      data, esperado: 2, timeZone: "America/Costa_Rica", conDia: false, abriendo: null, onOpen: () => {},
    }));
    expect(html).toContain("María Pérez");
    expect(html).toContain("+506 6123-4567");
    expect(html).toContain("Pedido generado");
    expect(html).toContain("Con pedido");
    expect(html).toContain("VIP");
    expect(html).toContain(`${horaDeGestion("2026-11-28T15:05:00.000Z", "America/Costa_Rica", false)} a ${horaDeGestion("2026-11-28T17:40:00.000Z", "America/Costa_Rica", false)}`);
    expect(html).toContain("1 pedido · 1 resultado");
    expect(html).toContain('aria-label="Abrir María Pérez, +506 6123-4567, Pedido generado"');
    // Un lead que ya no esta en la tienda se cuenta, pero no se puede abrir.
    expect(html).toContain("Lead #8");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain('role="status"');
  });

  it("avisa si el numero de la tabla ya no coincide o si el periodo se recorto", () => {
    const html = renderToStaticMarkup(createElement(ListaLeadsDeAsesora, {
      data: { ...data, incompleto: true }, esperado: 3, timeZone: "America/Costa_Rica", conDia: true, abriendo: 7, onOpen: () => {},
    }));
    expect(html).toContain("La tabla decía 3 y ahora hay 2");
    expect(html).toContain("demasiadas gestiones");
    expect(html).toContain("Abriendo…");
  });

  it("las horas salen en la zona de la tienda (Costa Rica: UTC-6)", () => {
    expect(horaDeGestion("2026-11-28T15:05:00.000Z", "America/Costa_Rica", false)).toMatch(/^9:05/);
    expect(horaDeGestion(null, "America/Costa_Rica", false)).toBe("—");
  });
});
