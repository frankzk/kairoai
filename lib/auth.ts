import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "kairo_session";
const SESSION_PAYLOAD = "kairo-admin";

function getAuthSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.APP_SECRET ?? "";
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toHex(signature);
}

export async function createSessionValue(): Promise<string> {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("Missing AUTH_SECRET or APP_SECRET");
  }
  const signature = await sign(SESSION_PAYLOAD, secret);
  return `${SESSION_PAYLOAD}.${signature}`;
}

export async function isValidSession(value?: string | null): Promise<boolean> {
  const secret = getAuthSecret();
  if (!secret || !value) return false;

  const [payload, signature] = value.split(".");
  if (payload !== SESSION_PAYLOAD || !signature) return false;

  const expected = await sign(payload, secret);
  return signature === expected;
}

export async function isAuthenticated(req: NextRequest): Promise<boolean> {
  return isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
}

export function isValidPassword(password: string): boolean {
  const configuredPassword = process.env.ADMIN_PASSWORD ?? process.env.APP_SECRET ?? "";
  return Boolean(configuredPassword && password === configuredPassword);
}
