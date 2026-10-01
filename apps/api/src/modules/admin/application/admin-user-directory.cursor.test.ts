import { afterEach, describe, expect, it } from "vitest";
import { decodeAdminAuditCursor } from "./admin-audit.cursor.ts";
import { decodeAdminUserDirectoryCursor, encodeAdminUserDirectoryCursor } from "./admin-user-directory.cursor.ts";

const filter = { mode: "browse" as const, status: "active" as const, query: null, limit: 25 };
const position = { createdAt: "2026-09-24T12:00:00.000Z", userId: "11111111-1111-4111-8111-111111111111" };
const previousJwtSecret = process.env.JWT_SECRET;

afterEach(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

describe("admin user directory cursor", () => {
  it("round-trips a signed cursor bound to the exact filter", () => {
    const cursor = encodeAdminUserDirectoryCursor(position, filter, { secret: "test-secret", now: 1_000 });
    expect(decodeAdminUserDirectoryCursor(cursor, filter, { secret: "test-secret", now: 1_100 })).toEqual(position);
  });

  it("rejects tampering, expiry and filter changes", () => {
    const cursor = encodeAdminUserDirectoryCursor(position, filter, { secret: "test-secret", now: 1_000, ttlSeconds: 60 });
    expect(() => decodeAdminUserDirectoryCursor(`${cursor}x`, filter, { secret: "test-secret", now: 1_010 })).toThrow("invalid cursor");
    expect(() => decodeAdminUserDirectoryCursor(cursor, filter, { secret: "test-secret", now: 1_061 })).toThrow("invalid cursor");
    expect(() => decodeAdminUserDirectoryCursor(cursor, { ...filter, status: "restricted" }, { secret: "test-secret", now: 1_010 })).toThrow("invalid cursor");
  });

  it("derives a directory-specific key from JWT_SECRET", () => {
    process.env.JWT_SECRET = "cursor-root-secret-for-tests-only";
    const cursor = encodeAdminUserDirectoryCursor(position, filter, { now: 1_000 });
    expect(decodeAdminUserDirectoryCursor(cursor, filter, { now: 1_100 })).toEqual(position);
    expect(() => decodeAdminAuditCursor(cursor, position.userId, {}, { now: 1_100 })).toThrow("invalid cursor");
  });
});
