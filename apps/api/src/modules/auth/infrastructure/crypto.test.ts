import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptIdentity, encryptIdentity } from "./auth-crypto.ts";

const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.AUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterAll(() => {
  if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
  else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
});

describe("encryptIdentity / decryptIdentity", () => {
  it("round-trips an arbitrary JSON payload", () => {
    const payload = { api_key: "sk-test-123", nested: { ok: true } };
    const encrypted = encryptIdentity(payload);
    expect(encrypted.toString("utf8")).not.toContain("sk-test-123");
    expect(decryptIdentity(encrypted)).toEqual(payload);
  });

  it("fails to decrypt if the ciphertext was tampered with", () => {
    const encrypted = encryptIdentity({ api_key: "sk-test-123" });
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 0xff;
    expect(() => decryptIdentity(encrypted)).toThrow();
  });

  it("fails before decryption when the IV or authentication tag is truncated", () => {
    expect(() => decryptIdentity(Buffer.alloc(27))).toThrow("Зашифрованные данные повреждены");
  });
});
