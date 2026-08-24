import { describe, expect, it, afterEach } from "vitest";
import crypto from "crypto";
import {
  buildParamsString,
  isValidSipLogin,
  isZadarmaNotifyIp,
  parseZadarmaTime,
  signRequest,
  signatureStringForEvent,
  toPbxExtensions,
  verifyNotifySignature,
} from "@/lib/zadarma";

// Vectores generados con la implementacion de referencia de Zadarma (paquete
// npm `zadarma` v1.1.2, que usa http_build_query + md5 + hmac-sha1 + base64).
// Si la firma se rompe, la API responde "not authorized" y nadie puede llamar,
// asi que se fija aqui contra una fuente externa y no contra nuestro propio
// codigo.
const SECRET = "sk000000000000000000"; // 20 caracteres, como los secretos reales

describe("firma de la API de Zadarma", () => {
  it("ordena los parametros y los serializa como http_build_query", () => {
    expect(buildParamsString({ to: "50688887777", from: "499499-100", sip: "499499-100" })).toBe(
      "from=499499-100&sip=499499-100&to=50688887777"
    );
  });

  it("codifica espacios como '+' y reservados como PHP", () => {
    expect(buildParamsString({ b: "hola mundo", a: "x+y/z", c: "ñ" })).toBe(
      "a=x%2By%2Fz&b=hola+mundo&c=%C3%B1"
    );
  });

  it("omite los parametros indefinidos en vez de mandarlos vacios", () => {
    expect(buildParamsString({ from: "100", sip: undefined })).toBe("from=100");
  });

  it("reproduce la firma de referencia de un callback", () => {
    const { signature, paramsString } = signRequest(
      "/v1/request/callback/",
      { to: "50688887777", from: "499499-100", sip: "499499-100" },
      SECRET
    );
    expect(paramsString).toBe("from=499499-100&sip=499499-100&to=50688887777");
    expect(signature).toBe("OGIxZDkyNzJmNzQzMmQwNzUzMTJlYjhmMTM4NGU2MzgxY2VhODhhOQ==");
  });

  it("reproduce la firma de referencia de get_key", () => {
    const { signature } = signRequest("/v1/webrtc/get_key/", { sip: "499499-101" }, SECRET);
    expect(signature).toBe("MmJmM2RmMjEwZTVjZWQ4NzIzODBlNjcwNmFjOWMxMmE1ZjY5MmNiZQ==");
  });

  it("firma tambien los metodos sin parametros", () => {
    const { paramsString, signature } = signRequest("/v1/info/balance/", {}, SECRET);
    expect(paramsString).toBe("");
    expect(signature).toBe("NjlkOTQzYjZhNzRhMmZjZjQ1YTY5MjYxYzE1YTM1YTEwMWE3ZWMxOA==");
  });
});

describe("listado de extensiones (/v1/pbx/internal/)", () => {
  it("une el id de la centralita con el numero corto", () => {
    // La API devuelve numbers como enteros; el login del widget es el string.
    expect(toPbxExtensions(499499, [100, 101])).toEqual([
      { number: "100", sip: "499499-100" },
      { number: "101", sip: "499499-101" },
    ]);
  });

  it("deja el numero solo si la cuenta no reporta pbx_id", () => {
    expect(toPbxExtensions(undefined, ["100"])).toEqual([{ number: "100", sip: "100" }]);
  });

  it("devuelve lista vacia sin extensiones", () => {
    expect(toPbxExtensions(499499, undefined)).toEqual([]);
  });

  it("produce logins que el resto del modulo acepta", () => {
    for (const extension of toPbxExtensions(499499, [100, 101, 102, 103, 104])) {
      expect(isValidSipLogin(extension.sip)).toBe(true);
    }
  });
});

describe("extensiones de la centralita", () => {
  it("acepta el login completo y la extension corta", () => {
    expect(isValidSipLogin("499499-100")).toBe(true);
    expect(isValidSipLogin("100")).toBe(true);
  });

  it("rechaza lo que no es una extension", () => {
    expect(isValidSipLogin("")).toBe(false);
    expect(isValidSipLogin("100; drop")).toBe(false);
    expect(isValidSipLogin("499499-100-100")).toBe(false);
    expect(isValidSipLogin("+50688887777 ")).toBe(false);
  });
});

describe("firma de las notificaciones", () => {
  const signEvent = (value: string) =>
    Buffer.from(crypto.createHmac("sha1", SECRET).update(value).digest("hex")).toString("base64");

  it("usa internal+destination+call_start en las salientes", () => {
    expect(
      signatureStringForEvent("NOTIFY_OUT_END", {
        internal: "499499-100",
        destination: "50688887777",
        call_start: "2026-08-24 10:15:00",
      })
    ).toBe("499499-100506888877772026-08-24 10:15:00");
  });

  it("usa caller_id+called_did+call_start en las entrantes", () => {
    expect(
      signatureStringForEvent("NOTIFY_START", {
        caller_id: "50688887777",
        called_did: "50640000000",
        call_start: "2026-08-24 10:15:00",
      })
    ).toBe("50688887777506400000002026-08-24 10:15:00");
  });

  it("usa pbx_call_id+call_id_with_rec en las grabaciones", () => {
    expect(
      signatureStringForEvent("NOTIFY_RECORD", { pbx_call_id: "abc", call_id_with_rec: "def" })
    ).toBe("abcdef");
  });

  it("devuelve null para eventos que no manejamos", () => {
    expect(signatureStringForEvent("DOCUMENT", {})).toBeNull();
    expect(signatureStringForEvent("NOTIFY_INTERNAL_END", {})).toBeNull();
  });

  it("acepta una firma valida y rechaza una alterada", () => {
    const value = "499499-100506888877772026-08-24 10:15:00";
    expect(verifyNotifySignature(value, signEvent(value), SECRET)).toBe(true);
    expect(verifyNotifySignature(value, signEvent(`${value}x`), SECRET)).toBe(false);
  });

  it("rechaza cuando falta la firma o el secreto", () => {
    const value = "algo";
    expect(verifyNotifySignature(value, null, SECRET)).toBe(false);
    expect(verifyNotifySignature(value, signEvent(value), "")).toBe(false);
  });

  it("no revienta con firmas de largo distinto", () => {
    expect(verifyNotifySignature("algo", "corta", SECRET)).toBe(false);
  });
});

describe("IP de origen de las notificaciones", () => {
  it("acepta el rango 185.45.152.40/30", () => {
    for (const ip of ["185.45.152.40", "185.45.152.41", "185.45.152.42", "185.45.152.43"]) {
      expect(isZadarmaNotifyIp(ip)).toBe(true);
    }
  });

  it("toma la primera IP de la cadena de proxies", () => {
    expect(isZadarmaNotifyIp("185.45.152.42, 10.0.0.1")).toBe(true);
  });

  it("rechaza fuera del rango y valores vacios", () => {
    expect(isZadarmaNotifyIp("185.45.152.44")).toBe(false);
    expect(isZadarmaNotifyIp("1.2.3.4")).toBe(false);
    expect(isZadarmaNotifyIp(null)).toBe(false);
  });
});

describe("hora de la centralita", () => {
  const original = process.env.ZADARMA_TIMEZONE_OFFSET;
  afterEach(() => {
    if (original === undefined) delete process.env.ZADARMA_TIMEZONE_OFFSET;
    else process.env.ZADARMA_TIMEZONE_OFFSET = original;
  });

  it("interpreta la hora como UTC cuando no hay offset configurado", () => {
    delete process.env.ZADARMA_TIMEZONE_OFFSET;
    expect(parseZadarmaTime("2026-08-24 10:15:00")).toBe("2026-08-24T10:15:00.000Z");
  });

  it("aplica el offset de la cuenta", () => {
    process.env.ZADARMA_TIMEZONE_OFFSET = "-06:00";
    expect(parseZadarmaTime("2026-08-24 10:15:00")).toBe("2026-08-24T16:15:00.000Z");
  });

  it("ignora un offset mal escrito en vez de descartar la fecha", () => {
    process.env.ZADARMA_TIMEZONE_OFFSET = "menos seis";
    expect(parseZadarmaTime("2026-08-24 10:15:00")).toBe("2026-08-24T10:15:00.000Z");
  });

  it("devuelve null si no hay fecha", () => {
    expect(parseZadarmaTime(undefined)).toBeNull();
    expect(parseZadarmaTime("no es fecha")).toBeNull();
  });
});
