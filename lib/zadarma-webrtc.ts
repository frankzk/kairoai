// Teléfono propio de Zadarma en el navegador (components/ZadarmaPhone.tsx),
// sin el widget flotante. Cómo se conecta, en tres pasos:
//   1. Kairo pide a la API de Zadarma la llave WebRTC de la extensión de la
//      asesora (/v1/webrtc/get_key/, la misma que usaba el widget).
//   2. Con esa llave, el navegador pide a Zadarma la clave SIP y el servidor
//      de su extensión (get_webphone_data, lo que hace el propio widget; el
//      dominio de Kairo ya está autorizado en Zadarma para el widget).
//   3. JsSIP se registra como esa extensión por WebSocket (wss://<servidor>:4443)
//      y marca directo al cliente. Zadarma solo acepta clientes WebRTC con el
//      User-Agent "Zadarma webRTC".
// El paso 2 no está en la documentación pública de Zadarma: si un día cambia,
// el teléfono no conecta y el botón ofrece el proveedor de respaldo de la
// tienda (Configuración › Telefonía).
//
// Lo puro está aquí y se prueba en tests/zadarma-webrtc.test.ts.

export const ZADARMA_USER_AGENT = "Zadarma webRTC";
export const ZADARMA_WEBPHONE_DATA = "https://api.zadarma.com/sys/webrtc/get_webphone_data.php";
export const ZADARMA_ICE = [{ urls: "stun:stun.l.google.com:19302" }];

export interface CredencialesSip {
  uri: string;
  authUser: string;
  password: string;
  wsUrl: string;
  domain: string;
}

/** Lo que devuelve get_webphone_data: { pass, domain } o { error }. */
export function credencialesDeWebphone(sip: string, data: unknown): CredencialesSip {
  const d = (data && typeof data === "object" ? data : {}) as { pass?: unknown; domain?: unknown; error?: unknown };
  const pass = typeof d.pass === "string" ? d.pass : "";
  const domain = typeof d.domain === "string" ? d.domain.trim() : "";
  if (!pass || !/^[a-z0-9.-]+$/i.test(domain)) {
    const err = d.error && typeof d.error === "object" ? (d.error as { content?: unknown }).content : d.error;
    throw new Error(typeof err === "string" && err ? `Zadarma: ${err}` : "Zadarma no entregó los datos de la extensión.");
  }
  return { uri: `sip:${sip}@${domain}`, authUser: sip, password: pass, wsUrl: `wss://${domain}:4443`, domain };
}

/**
 * Destino SIP: el número internacional CON "+" en el servidor de la extensión.
 * Sin el "+" Zadarma no lo toma como internacional y la llamada sale "no ha
 * podido realizarse" (18/11/2026: 50432193330 falló; +504… salía bien).
 */
export function destinoSip(numero: string, domain: string): string {
  return `sip:+${numero.replace(/\D/g, "")}@${domain}`;
}

/**
 * La llamada no llegó a sonar por un problema de nuestro lado o de Zadarma
 * (conexión, credenciales, saldo, servidor), no del cliente. Es cuando tiene
 * sentido ofrecer el proveedor de respaldo.
 */
export function esFalloDelProveedor(causa: string | null | undefined, llegoASonar: boolean): boolean {
  if (llegoASonar) return false;
  const c = String(causa ?? "");
  const delCliente = ["Busy", "Unavailable", "No Answer", "Canceled", "Not Found", "Address Incomplete", "User Denied Media Access"];
  return c !== "" && !delCliente.includes(c);
}

/** La causa de JsSIP en el idioma de premarcar (lib/telefonia-cliente.ts). */
export function causaParaSugerencia(causa: string | null | undefined): string | null {
  if (causa === "Busy") return "USER_BUSY";
  if (causa === "Rejected") return "CALL_REJECTED";
  return causa ?? null;
}

const MENSAJE_CAUSA: Record<string, string> = {
  Busy: "El cliente está ocupado.",
  Rejected: "La llamada fue rechazada.",
  Unavailable: "El cliente no está disponible.",
  "No Answer": "El cliente no contestó.",
  "Not Found": "Ese número no existe.",
  "Address Incomplete": "El número está incompleto.",
  "Connection Error": "Se perdió la conexión con Zadarma.",
  "Request Timeout": "Zadarma no respondió a tiempo.",
  "Authentication Error": "Zadarma rechazó la extensión: reconectando…",
  "User Denied Media Access": "Permite el acceso al micrófono en el navegador.",
  "WebRTC Error": "No se pudo iniciar el audio de la llamada. Revisa el micrófono.",
  "SIP Failure Code": "Zadarma rechazó la llamada.",
  "Internal Error": "Error interno del teléfono.",
};

/** Qué suele significar cada código SIP con que Zadarma rechaza una llamada. */
const PISTA_CODIGO: Record<number, string> = {
  402: "sin saldo o límite de gasto",
  403: "Zadarma no permite esa llamada: revisa en Zadarma las restricciones de llamadas a ese país y el número saliente (CallerID) de la extensión",
  404: "el número no existe o está mal escrito",
  408: "no hubo respuesta",
  480: "el número no está disponible",
  484: "número incompleto",
  486: "ocupado",
  488: "audio no compatible",
  503: "el servicio de Zadarma no está disponible para ese destino",
  603: "rechazada",
};

export function mensajeDeCausa(causa: string | null | undefined, sip: { codigo?: number; razon?: string } = {}): string {
  const base = MENSAJE_CAUSA[String(causa ?? "")] ?? `No se pudo completar la llamada${causa ? ` (${causa})` : ""}.`;
  if (!sip.codigo) return base;
  const pista = PISTA_CODIGO[sip.codigo];
  return `${base} Código ${sip.codigo}${sip.razon ? ` ${sip.razon}` : ""}${pista ? `: ${pista}.` : "."}`;
}

/** Pide get_webphone_data por JSONP: el endpoint lo envuelve en un callback. */
export function pedirDatosWebphone(key: string, sip: string, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const nombre = `kairoZd${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    const limpiar = () => {
      window.clearTimeout(timer);
      delete w[nombre];
      script.remove();
    };
    const timer = window.setTimeout(() => {
      limpiar();
      reject(new Error("Zadarma no respondió a tiempo."));
    }, timeoutMs);
    w[nombre] = (data: unknown) => {
      limpiar();
      resolve(data);
    };
    const params = new URLSearchParams({ jsonpCallback: nombre, integrationType: "site", key, sipId: sip });
    script.src = `${ZADARMA_WEBPHONE_DATA}?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      limpiar();
      reject(new Error("No se pudo contactar a Zadarma. Revisa la conexión a internet."));
    };
    document.head.appendChild(script);
  });
}
