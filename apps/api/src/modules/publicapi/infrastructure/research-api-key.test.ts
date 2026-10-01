import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResearchApiKeyHash, createResearchApiKeyVerifier, parseResearchApiKey, RESEARCH_API_KEY_PREFIX } from "./research-api-key.ts";

import type { ProfileAuthPort } from "../../profile/public/index.ts";

const profiles = { loadOwnerAuthState: vi.fn<ProfileAuthPort["loadOwnerAuthState"]>() };
beforeEach(() => {
  profiles.loadOwnerAuthState.mockReset();
  profiles.loadOwnerAuthState.mockResolvedValue({ status: "active", administrativeState: "active", sessionVersion: 1 });
});

const publicId = randomBytes(16).toString("base64url");
const secret = `${RESEARCH_API_KEY_PREFIX}${publicId}.${randomBytes(32).toString("base64url")}`;
const row = { id: "key-1", user_id: "researcher-1", scope: "research" as const, key_hash: await createResearchApiKeyHash(secret) };

describe("формат research API-ключа", () => {
  const encodedPublicId = Buffer.alloc(16).toString("base64url");
  const encodedSecret = Buffer.alloc(32).toString("base64url");

  it("принимает canonical ключ", () => {
    const key = `${RESEARCH_API_KEY_PREFIX}${encodedPublicId}.${encodedSecret}`;
    expect(parseResearchApiKey(key)).toEqual({ key, publicId: `research_${encodedPublicId}` });
  });

  it.each([
    ["короткий public ID", encodedPublicId.slice(1), encodedSecret],
    ["длинный public ID", `${encodedPublicId}A`, encodedSecret],
    ["короткий secret", encodedPublicId, encodedSecret.slice(1)],
    ["длинный secret", encodedPublicId, `${encodedSecret}A`],
    ["padding public ID", `${encodedPublicId}=`, encodedSecret],
    ["padding secret", encodedPublicId, `${encodedSecret}=`],
    ["дополнительный separator", encodedPublicId, `${encodedSecret}.`],
    ["separator при прежней длине", encodedPublicId, `${encodedSecret.slice(1)}.`],
    ["неверные decoded sizes при прежней общей длине", Buffer.alloc(15).toString("base64url"), Buffer.alloc(33).toString("base64url")],
  ])("отвергает: %s", (_name, id, keySecret) => {
    expect(parseResearchApiKey(`${RESEARCH_API_KEY_PREFIX}${id}.${keySecret}`)).toBeNull();
  });
});

function database(rows: (typeof row)[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe("проверка research API-ключа", () => {
  it("принимает только активный ключ с research scope", async () => {
    const db = database([row]);

    await expect(createResearchApiKeyVerifier(db as never, profiles).verify(secret)).resolves.toEqual({
      status: "authenticated",
      principal: { id: "key-1", userId: "researcher-1", scope: "research" },
    });
    expect(profiles.loadOwnerAuthState).toHaveBeenCalledWith(row.user_id);
  });

  it.each(["restricted", "deleted", null] as const)("отвергает владельца: %s", async (status) => {
    profiles.loadOwnerAuthState.mockResolvedValue(status === null ? null : { status, administrativeState: "active", sessionVersion: 1 });
    const db = database([row]);
    await expect(createResearchApiKeyVerifier(db as never, profiles).verify(secret)).resolves.toEqual({ status: "invalid" });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("last_used_at"))).toBe(false);
  });

  it("отказывает при ошибке загрузки владельца", async () => {
    profiles.loadOwnerAuthState.mockRejectedValue(new Error("profile unavailable"));
    const db = database([row]);
    await expect(createResearchApiKeyVerifier(db as never, profiles).verify(secret)).resolves.toEqual({ status: "invalid" });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("last_used_at"))).toBe(false);
  });

  it.each([
    ["пустой ключ", ""],
    ["неверный префикс", "mf_pub_fixture-secret"],
    ["публичный scope", secret],
  ])("отказывает: %s", async (_name, rawKey) => {
    const db = database(_name === "публичный scope" ? [{ ...row, scope: "public_api" as never }] : []);
    await expect(createResearchApiKeyVerifier(db as never, profiles).verify(rawKey)).resolves.toEqual({ status: "invalid" });
  });

  it("передаёт в БД только публичный идентификатор и фильтрует active/research", async () => {
    const db = database([row]);
    await createResearchApiKeyVerifier(db as never, profiles).verify(secret);

    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([`research_${publicId}`]);
    expect(params).not.toContain(secret);
    expect(sql).toContain("scope = 'research'");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("revoked_at is null");
    expect(sql).toContain("expires_at is null or expires_at > now()");
  });

  it("отвергает неверный секрет с тем же идентификатором", async () => {
    const db = database([row]);
    const wrong = `${RESEARCH_API_KEY_PREFIX}${publicId}.${randomBytes(32).toString("base64url")}`;
    await expect(createResearchApiKeyVerifier(db as never, profiles).verify(wrong)).resolves.toEqual({ status: "invalid" });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(profiles.loadOwnerAuthState).not.toHaveBeenCalled();
  });

  it.each([Buffer.alloc(32), Buffer.alloc(row.key_hash.length), null])("отвергает старый или повреждённый hash: %s", async (keyHash) => {
    const db = database([{ ...row, key_hash: keyHash as never }]);
    await expect(createResearchApiKeyVerifier(db as never, profiles).verify(secret)).resolves.toEqual({ status: "invalid" });
  });

  it("создаёт разные salted hashes одного ключа", async () => {
    expect(await createResearchApiKeyHash(secret)).not.toEqual(row.key_hash);
  });

  it("не принимает старый формат ключа", async () => {
    const db = database([row]);
    await expect(createResearchApiKeyVerifier(db as never, profiles).verify(`${RESEARCH_API_KEY_PREFIX}fixture-secret`)).resolves.toEqual({ status: "invalid" });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("ограничивает параллельные проверки и освобождает слот после ошибки", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = {
      query: vi.fn(async () => {
        await pending;
        throw new Error("database unavailable");
      }),
    };
    const verifier = createResearchApiKeyVerifier(db as never, profiles);
    const first = verifier.verify(secret);
    const second = verifier.verify(secret);
    await expect(verifier.verify(secret)).resolves.toEqual({ status: "busy" });
    await expect(verifier.verify("malformed")).resolves.toEqual({ status: "invalid" });
    expect(db.query).toHaveBeenCalledTimes(2);
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([{ status: "invalid" }, { status: "invalid" }]);
    await expect(createResearchApiKeyVerifier(database([row]) as never, profiles).verify(secret)).resolves.toEqual({
      status: "authenticated",
      principal: { id: row.id, userId: row.user_id, scope: row.scope },
    });
  });
});
