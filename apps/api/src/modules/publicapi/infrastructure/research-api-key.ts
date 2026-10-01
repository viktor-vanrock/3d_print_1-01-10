import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ProfileAuthPort } from "../../profile/public/index.ts";

export const RESEARCH_API_KEY_PREFIX = "mf_research_";
export const RESEARCH_API_KEY_SCOPE = "research" as const;
export const RESEARCH_API_KEY_PERMISSION = "write" as const;

export type ResearchApiKeyPrincipal = {
  id: string;
  userId: string;
  scope: typeof RESEARCH_API_KEY_SCOPE;
};

export type ResearchApiKeyVerification =
  | { status: "authenticated"; principal: ResearchApiKeyPrincipal }
  | { status: "invalid" }
  | { status: "busy" };

type ResearchApiKeyRow = {
  id: string;
  user_id: string;
  scope: typeof RESEARCH_API_KEY_SCOPE;
  key_hash: unknown;
};

const HASH_HEADER = Buffer.from("research-scrypt-v1\0", "ascii");
const PUBLIC_ID_BYTES = 16;
const SECRET_BYTES = 32;
const KEY_SEPARATOR = ".";
const PUBLIC_ID_LENGTH = Math.ceil((PUBLIC_ID_BYTES * 4) / 3);
const SECRET_LENGTH = Math.ceil((SECRET_BYTES * 4) / 3);
const KEY_LENGTH = RESEARCH_API_KEY_PREFIX.length + PUBLIC_ID_LENGTH + KEY_SEPARATOR.length + SECRET_LENGTH;
const SALT_BYTES = 16;
const DIGEST_BYTES = 32;
const MAX_CONCURRENT_CHECKS = 2;
let activeChecks = 0;

function canonicalPart(value: string, bytes: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === value;
}

export function parseResearchApiKey(value: unknown): { key: string; publicId: string } | null {
  if (typeof value !== "string" || value.length !== KEY_LENGTH || !value.startsWith(RESEARCH_API_KEY_PREFIX)) return null;
  const [publicId, secret] = value.slice(RESEARCH_API_KEY_PREFIX.length).split(KEY_SEPARATOR);
  if (!publicId || !secret || !canonicalPart(publicId, PUBLIC_ID_BYTES) || !canonicalPart(secret, SECRET_BYTES)) return null;
  return { key: value, publicId: `research_${publicId}` };
}

function deriveKey(key: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(key, salt, DIGEST_BYTES, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function createResearchApiKeyHash(key: string): Promise<Buffer> {
  if (!parseResearchApiKey(key)) throw new Error("Invalid research API key format");
  const salt = randomBytes(SALT_BYTES);
  return Buffer.concat([HASH_HEADER, salt, await deriveKey(key, salt)]);
}

/** Проверяет только ключ машинного контура research; plaintext в БД не попадает. */
export function createResearchApiKeyVerifier(db: Pool | PoolClient, profiles: Pick<ProfileAuthPort, "loadOwnerAuthState">) {
  return {
    async verify(rawKey: unknown): Promise<ResearchApiKeyVerification> {
      const parsed = parseResearchApiKey(rawKey);
      if (!parsed) return { status: "invalid" };
      if (activeChecks >= MAX_CONCURRENT_CHECKS) return { status: "busy" };
      activeChecks += 1;

      try {
        const result = await db.query<ResearchApiKeyRow>(
          `select id, user_id, scope, key_hash from user_api_keys
           where key_prefix = $1 and scope = 'research' and scopes = array['write']::text[]
             and status = 'active'
             and revoked_at is null
             and (expires_at is null or expires_at > now())
           limit 1`,
          [parsed.publicId],
        );
        const row = result.rows[0];
        if (!row || row.scope !== RESEARCH_API_KEY_SCOPE) return { status: "invalid" };
        const stored = row.key_hash;
        if (!Buffer.isBuffer(stored) || stored.length !== HASH_HEADER.length + SALT_BYTES + DIGEST_BYTES || !stored.subarray(0, HASH_HEADER.length).equals(HASH_HEADER))
          return { status: "invalid" };
        const salt = stored.subarray(HASH_HEADER.length, HASH_HEADER.length + SALT_BYTES);
        const digest = stored.subarray(HASH_HEADER.length + SALT_BYTES);
        if (!timingSafeEqual(await deriveKey(parsed.key, salt), digest)) return { status: "invalid" };

        const owner = await profiles.loadOwnerAuthState(UserId(row.user_id));
        if (owner === null || owner.status !== "active") return { status: "invalid" };

        db.query(`update user_api_keys set last_used_at = now() where id = $1`, [row.id]).catch(() => {});
        return { status: "authenticated", principal: { id: row.id, userId: row.user_id, scope: row.scope } };
      } catch {
        return { status: "invalid" };
      } finally {
        activeChecks -= 1;
      }
    },
  };
}
