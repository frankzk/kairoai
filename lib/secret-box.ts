// Cifrado de secretos guardados en la base (AES-256-GCM). Solo servidor.
//
// Formato: "v1.<kid>.<iv>.<tag>.<ct>" (base64url). `kid` identifica la clave
// (hash corto), no es la clave. El AAD ata cada texto cifrado a su fila y
// columna: copiarlo a otra tienda u otra columna hace fallar la apertura.
// Nunca se registra ni se devuelve el texto plano ni el valor de la clave.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

type Env = Record<string, string | undefined>;

export const SHIPHERO_KEY_VAR = "SHIPHERO_TOKEN_KEY";

export class SecretKeyError extends Error {
  constructor(
    readonly reason: "missing" | "invalid" | "changed",
    readonly varName: string,
  ) {
    super(
      reason === "missing"
        ? `Pendiente: configurar ${varName}.`
        : reason === "invalid"
          ? `${varName} no es válida: debe ser una clave de 32 bytes en base64 o hex.`
          : "La clave de cifrado cambió: vuelve a conectar ShipHero.",
    );
    this.name = "SecretKeyError";
  }
}

function decodeKey(raw: string | undefined): Buffer | "missing" | "invalid" {
  const value = raw?.trim() ?? "";
  if (!value) return "missing";
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    const key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (key.length === 32) return key;
  }
  return "invalid";
}

const kidOf = (key: Buffer) =>
  createHash("sha256")
    .update("kairo-secret-box:")
    .update(key)
    .digest("hex")
    .slice(0, 8);

/** "ok" | "missing" | "invalid". Never returns or logs the value. */
export function secretKeyStatus(
  env: Env,
  varName: string,
): "ok" | "missing" | "invalid" {
  const key = decodeKey(env[varName]);
  return Buffer.isBuffer(key) ? "ok" : key;
}

/** 32-byte key from base64 (44 chars, padded) or hex (64 chars). Throws SecretKeyError. */
export function loadSecretKey(
  env: Env,
  varName: string,
): { key: Buffer; kid: string } {
  const key = decodeKey(env[varName]);
  if (!Buffer.isBuffer(key)) throw new SecretKeyError(key, varName);
  return { key, kid: kidOf(key) };
}

const b64 = (value: Buffer) => value.toString("base64url");

/** "v1.<kid>.<iv b64url>.<tag b64url>.<ct b64url>". Random 12-byte IV, 16-byte tag. */
export function sealSecret(
  plain: string,
  opts: { key: Buffer; kid: string; aad: string },
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", opts.key, iv);
  cipher.setAAD(Buffer.from(opts.aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", opts.kid, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

/** Kid of a sealed value (null when the format is wrong). */
export function sealedKid(sealed: string): string | null {
  const parts = sealed.split(".");
  return parts.length === 5 && parts[0] === "v1" && /^[0-9a-f]{8}$/.test(parts[1])
    ? parts[1]
    : null;
}

/**
 * Opens with the current key or with `${varName}_PREVIOUS`, chosen by kid.
 * Throws SecretKeyError("changed") on a kid that matches neither, or a generic
 * Error("Secreto inválido") on tamper. The plaintext never goes into a message.
 */
export function openSecret(
  sealed: string,
  opts: { env: Env; varName: string; aad: string },
): string {
  const current = loadSecretKey(opts.env, opts.varName);
  const parts = sealed.split(".");
  const kid = sealedKid(sealed);
  if (!kid) throw new Error("Secreto inválido");
  let key: Buffer | null = kid === current.kid ? current.key : null;
  if (!key) {
    const previous = decodeKey(opts.env[`${opts.varName}_PREVIOUS`]);
    if (Buffer.isBuffer(previous) && kidOf(previous) === kid) key = previous;
  }
  if (!key) throw new SecretKeyError("changed", opts.varName);
  try {
    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(opts.aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(parts[4], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Secreto inválido");
  }
}

/** True when the sealed value was made with the current key (no reseal needed). */
export function sealedWithCurrentKey(
  sealed: string,
  env: Env,
  varName: string,
): boolean {
  const key = decodeKey(env[varName]);
  return Buffer.isBuffer(key) && sealedKid(sealed) === kidOf(key);
}
