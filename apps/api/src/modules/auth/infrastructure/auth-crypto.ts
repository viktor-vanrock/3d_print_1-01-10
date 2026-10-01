import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} не задан`);
  return value;
}

export function identifierHash(identifier: string): Buffer {
  return createHmac("sha256", requireEnvironment("AUTH_HMAC_KEY")).update(identifier.trim().toLowerCase()).digest();
}

export function encryptIdentity(payload: unknown): Buffer {
  const key = Buffer.from(requireEnvironment("AUTH_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("AUTH_ENCRYPTION_KEY должен содержать 32 байта в base64");
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptIdentity(buf: Buffer): unknown {
  const key = Buffer.from(requireEnvironment("AUTH_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("AUTH_ENCRYPTION_KEY должен содержать 32 байта в base64");
  if (buf.length < GCM_IV_BYTES + GCM_TAG_BYTES) throw new Error("Зашифрованные данные повреждены");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, GCM_IV_BYTES), { authTagLength: GCM_TAG_BYTES });
  decipher.setAuthTag(buf.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(GCM_IV_BYTES + GCM_TAG_BYTES)), decipher.final()]).toString("utf8"));
}
