// El cliente del conector de iComfly (MCP) con que Kairo crea pedidos.
//
// POR QUE ESTE TEST EXISTE: desde el 28/10/2026 Shopify esta suspendido y el
// pedido de la asesora se crea en iComfly por aca. Cada clave ve UNA tienda:
// si se usara la de otra, el pedido de Honduras se crearia en Costa Rica. Y
// un error de iComfly ({"ok":false}) tiene que llegar a la asesora como error,
// no como "pedido creado".

import { describe, expect, it } from "vitest";
import { credencialMcp, llamarHerramientaIcomfly, mensajeJsonRpc, resultadoHerramienta } from "../lib/icomfly-mcp";

const ENV = {
  ICOMFLY_CR_MCP_URL: "https://api.icomfly.com/mcp/c_cr",
  ICOMFLY_CR_MCP_TOKEN: "icf_cr",
  ICOMFLY_HN_MCP_URL: "https://api.icomfly.com/mcp/c_hn",
  ICOMFLY_HN_MCP_TOKEN: "icf_hn",
};

const respuesta = (texto: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(texto) }], ...extra } });

describe("la clave de cada tienda", () => {
  it("Honduras usa la suya y Costa Rica la suya", () => {
    expect(credencialMcp("mireva-hn", ENV)).toMatchObject({ url: ENV.ICOMFLY_HN_MCP_URL, token: "icf_hn", faltan: [] });
    expect(credencialMcp("mireva-cr", ENV)).toMatchObject({ url: ENV.ICOMFLY_CR_MCP_URL, token: "icf_cr", faltan: [] });
  });

  it("sin clave dice qué variable falta (nunca el valor) y no llama a nadie", async () => {
    expect(credencialMcp("mireva-hn", { ICOMFLY_CR_MCP_TOKEN: "icf_cr" }).faltan).toEqual([
      "ICOMFLY_HN_MCP_URL",
      "ICOMFLY_HN_MCP_TOKEN",
    ]);
    let llamado = false;
    const fetchImpl = (async () => {
      llamado = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    await expect(llamarHerramientaIcomfly("mireva-hn", "crear_pedido", {}, { env: {}, fetchImpl })).rejects.toThrow(
      /ICOMFLY_HN_MCP_URL y ICOMFLY_HN_MCP_TOKEN/
    );
    expect(llamado).toBe(false);
  });
});

describe("la llamada", () => {
  it("va a la URL de la tienda, con su clave, como tools/call", async () => {
    const vistas: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      vistas.push({ url, init });
      return new Response(respuesta({ ok: true, pedido: { id: 729032, order_number: "EXCEL-MVMPVFBE-1UNUD" } }));
    }) as unknown as typeof fetch;
    const r = await llamarHerramientaIcomfly("mireva-hn", "crear_pedido", { telefono: "504" }, { env: ENV, fetchImpl });
    expect(r).toEqual({ ok: true, pedido: { id: 729032, order_number: "EXCEL-MVMPVFBE-1UNUD" } });
    expect(vistas[0].url).toBe(ENV.ICOMFLY_HN_MCP_URL);
    expect((vistas[0].init.headers as Record<string, string>).Authorization).toBe("Bearer icf_hn");
    expect(JSON.parse(String(vistas[0].init.body))).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "crear_pedido", arguments: { telefono: "504" } },
    });
  });

  it("una clave rechazada se explica", async () => {
    const fetchImpl = (async () => new Response('{"error":"x"}', { status: 401 })) as unknown as typeof fetch;
    await expect(llamarHerramientaIcomfly("mireva-cr", "crear_pedido", {}, { env: ENV, fetchImpl })).rejects.toThrow(
      /401: clave rechazada/
    );
  });
});

describe("la respuesta", () => {
  it("en JSON o como evento SSE", () => {
    expect(mensajeJsonRpc('{"jsonrpc":"2.0","id":1,"result":{}}')).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(mensajeJsonRpc('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"a":1}}\n\n')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { a: 1 },
    });
  });

  it("un error de iComfly es error, no pedido creado", () => {
    expect(() => resultadoHerramienta(JSON.parse(respuesta({ ok: false, error: "Falta la ciudad" })))).toThrow(
      "iComfly: Falta la ciudad"
    );
    expect(() => resultadoHerramienta(JSON.parse(respuesta("Herramienta deshabilitada", { isError: true })))).toThrow(
      /Herramienta deshabilitada/
    );
    expect(() => resultadoHerramienta({ jsonrpc: "2.0", id: 1, error: { message: "Tool not found" } })).toThrow(
      "iComfly: Tool not found"
    );
  });
});
