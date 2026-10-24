// El conector de Claude de iComfly (MCP), para ESCRIBIR en iComfly.
//
// La API REST de iComfly que usa Kairo (lib/icomfly.ts) solo lee pedidos. Para
// crear un pedido desde Leads (desde el 28/10/2026 Shopify esta suspendido) se
// usa el mismo servidor que el conector de Claude: JSON-RPC sobre HTTP, con la
// clave que se genera en iComfly -> Conector Claude. Cada clave ve UNA tienda:
// ICOMFLY_CR_MCP_URL / _TOKEN para Costa Rica, ICOMFLY_HN_MCP_URL / _TOKEN para
// Honduras. Sin sesion: cada llamada va sola (medido el 24/10/2026).
//
// crear_pedido devuelve el pedido creado (id interno y numero) en la misma
// respuesta; el webhook de entrada de iComfly solo contesta {"ok":true} y no
// reconocia los campos del pedido.

import type { FinanceStoreCode } from "@/lib/store-config";

const MCP_ENV_BY_CODE: Record<FinanceStoreCode, { url: string; token: string }> = {
  "mireva-cr": { url: "ICOMFLY_CR_MCP_URL", token: "ICOMFLY_CR_MCP_TOKEN" },
  "mireva-hn": { url: "ICOMFLY_HN_MCP_URL", token: "ICOMFLY_HN_MCP_TOKEN" },
};

const TIMEOUT_MS = 20000;

export interface CredencialMcp {
  url?: string;
  token?: string;
  /** Las variables que faltan, por nombre (nunca el valor). */
  faltan: string[];
}

export function credencialMcp(
  storeCode: FinanceStoreCode,
  env: Record<string, string | undefined> = process.env
): CredencialMcp {
  const nombres = MCP_ENV_BY_CODE[storeCode];
  const url = env[nombres.url]?.trim() || undefined;
  const token = env[nombres.token]?.trim() || undefined;
  return { url, token, faltan: [!url ? nombres.url : "", !token ? nombres.token : ""].filter(Boolean) };
}

/** El texto de una respuesta JSON-RPC, en JSON o en un evento SSE ("data: {...}"). */
export function mensajeJsonRpc(cuerpo: string): Record<string, unknown> {
  const texto = cuerpo.trim();
  if (texto.startsWith("{")) return JSON.parse(texto) as Record<string, unknown>;
  const datos = texto
    .split(/\r?\n/)
    .filter((linea) => linea.startsWith("data:"))
    .map((linea) => linea.slice(5).trim())
    .filter(Boolean);
  if (!datos.length) throw new Error("iComfly respondio sin datos");
  return JSON.parse(datos[datos.length - 1]) as Record<string, unknown>;
}

/**
 * Lo que devolvio la herramienta. iComfly manda el resultado como texto JSON
 * en content[0].text; un error llega con isError o con {"ok": false}.
 */
export function resultadoHerramienta(mensaje: Record<string, unknown>): Record<string, unknown> {
  const error = mensaje.error as { message?: string } | undefined;
  if (error) throw new Error(`iComfly: ${error.message || "error"}`);
  const result = (mensaje.result ?? {}) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const texto = result.content?.find((c) => c.type === "text")?.text ?? "";
  let datos: Record<string, unknown>;
  try {
    datos = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  } catch {
    datos = { mensaje: texto };
  }
  if (result.isError || datos.ok === false) {
    const motivo = String(datos.error ?? datos.message ?? datos.mensaje ?? (texto || "error"));
    throw new Error(`iComfly: ${motivo}`);
  }
  return datos;
}

export async function llamarHerramientaIcomfly(
  storeCode: FinanceStoreCode,
  nombre: string,
  args: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {}
): Promise<Record<string, unknown>> {
  const cred = credencialMcp(storeCode, opts.env);
  if (!cred.url || !cred.token) {
    throw new Error(`iComfly no configurado para crear pedidos: falta ${cred.faltan.join(" y ")}.`);
  }
  const res = await (opts.fetchImpl ?? fetch)(cred.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cred.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: nombre, arguments: args } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const cuerpo = await res.text();
  if (!res.ok) {
    const detalle = res.status === 401 ? "clave rechazada (revisa la clave del Conector Claude)" : cuerpo.slice(0, 200);
    throw new Error(`iComfly ${res.status}: ${detalle}`);
  }
  return resultadoHerramienta(mensajeJsonRpc(cuerpo));
}
