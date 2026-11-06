import { describe, expect, it } from "vitest";
import {
  SecretKeyError,
  loadSecretKey,
  openSecret,
  sealSecret,
  sealedWithCurrentKey,
  secretKeyStatus,
} from "../lib/secret-box";

const VAR = "SHIPHERO_TOKEN_KEY";
const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("hex");
const env = { [VAR]: KEY_A };
const aad = "shiphero:1:refresh";

describe("secret box (AES-256-GCM)", () => {
  it("round-trips, with a random IV, and never contains the plaintext", () => {
    const key = loadSecretKey(env, VAR);
    const one = sealSecret("refresh-token-plain", { ...key, aad });
    const two = sealSecret("refresh-token-plain", { ...key, aad });
    expect(one).not.toBe(two);
    expect(one.startsWith(`v1.${key.kid}.`)).toBe(true);
    expect(one).not.toContain("refresh-token-plain");
    expect(openSecret(one, { env, varName: VAR, aad })).toBe(
      "refresh-token-plain",
    );
  });

  it("fails on tamper and on another store's or column's AAD", () => {
    const sealed = sealSecret("secret", { ...loadSecretKey(env, VAR), aad });
    const parts = sealed.split(".");
    for (const index of [2, 3, 4]) {
      const copy = [...parts];
      const chars = copy[index].split("");
      chars[0] = chars[0] === "A" ? "B" : "A";
      copy[index] = chars.join("");
      expect(() => openSecret(copy.join("."), { env, varName: VAR, aad })).toThrow(
        "Secreto inválido",
      );
    }
    expect(() =>
      openSecret(sealed, { env, varName: VAR, aad: "shiphero:2:refresh" }),
    ).toThrow("Secreto inválido");
    expect(() =>
      openSecret(sealed, { env, varName: VAR, aad: "shiphero:1:access" }),
    ).toThrow("Secreto inválido");
    expect(() => openSecret("garbage", { env, varName: VAR, aad })).toThrow(
      "Secreto inválido",
    );
  });

  it("says clearly when the key is missing or invalid", () => {
    expect(secretKeyStatus({}, VAR)).toBe("missing");
    expect(() => loadSecretKey({}, VAR)).toThrow(
      "Pendiente: configurar SHIPHERO_TOKEN_KEY.",
    );
    expect(secretKeyStatus({ [VAR]: Buffer.alloc(16).toString("base64") }, VAR)).toBe("invalid");
    expect(secretKeyStatus({ [VAR]: Buffer.alloc(48, 200).toString("base64") }, VAR)).toBe("invalid");
    expect(secretKeyStatus({ [VAR]: "not a key" }, VAR)).toBe("invalid");
    expect(secretKeyStatus({ [VAR]: KEY_A }, VAR)).toBe("ok");
    expect(secretKeyStatus({ [VAR]: KEY_B }, VAR)).toBe("ok");
    try {
      loadSecretKey({ [VAR]: "short" }, VAR);
    } catch (error) {
      expect(error).toBeInstanceOf(SecretKeyError);
      expect((error as SecretKeyError).reason).toBe("invalid");
      expect((error as Error).message).not.toContain("short");
    }
  });

  it("opens with the previous key by kid, and reports a changed key", () => {
    const sealed = sealSecret("secret", { ...loadSecretKey(env, VAR), aad });
    const rotated = { [VAR]: KEY_B, [`${VAR}_PREVIOUS`]: KEY_A };
    expect(openSecret(sealed, { env: rotated, varName: VAR, aad })).toBe("secret");
    expect(sealedWithCurrentKey(sealed, rotated, VAR)).toBe(false);
    expect(sealedWithCurrentKey(sealed, env, VAR)).toBe(true);
    try {
      openSecret(sealed, { env: { [VAR]: KEY_B }, varName: VAR, aad });
      throw new Error("should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SecretKeyError);
      expect((error as SecretKeyError).reason).toBe("changed");
    }
  });
});
