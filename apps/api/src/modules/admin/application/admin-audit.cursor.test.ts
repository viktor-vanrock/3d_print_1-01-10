import { afterEach, describe, expect, it } from "vitest";
import { decodeAdminUserDirectoryCursor } from "./admin-user-directory.cursor.ts";
import { decodeAdminAuditCursor, encodeAdminAuditCursor } from "./admin-audit.cursor.ts";

const filter = {
  actorId: "00000000-0000-4000-8000-000000000001",
  action: "admin.user.viewed",
  targetType: "user",
  actorFilter: null,
  targetFilter: null,
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-10-01T00:00:00.000Z",
  limit: 50,
} as const;
const previousJwtSecret = process.env.JWT_SECRET;

afterEach(() => {
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

describe("admin audit cursor", () => {
  it("round-trips absolute bounds, filters, actor and position", () => {
    const cursor = encodeAdminAuditCursor(filter, { createdAt: "2026-09-20T00:00:00.000Z", id: "00000000-0000-4000-8000-000000000002" }, { secret: "test", now: 100 });
    expect(decodeAdminAuditCursor(cursor, filter.actorId, {}, { secret: "test", now: 101 })).toEqual({
      filter,
      position: { createdAt: "2026-09-20T00:00:00.000Z", id: "00000000-0000-4000-8000-000000000002" },
    });
  });

  it("rejects tampering, another actor, expiry and changed supplied filters", () => {
    const cursor = encodeAdminAuditCursor(filter, { createdAt: "2026-09-20T00:00:00.000Z", id: "00000000-0000-4000-8000-000000000002" }, { secret: "test", now: 100, ttlSeconds: 60 });
    expect(() => decodeAdminAuditCursor(`${cursor}x`, filter.actorId, {}, { secret: "test", now: 101 })).toThrow("invalid cursor");
    expect(() => decodeAdminAuditCursor(cursor, "00000000-0000-4000-8000-000000000009", {}, { secret: "test", now: 101 })).toThrow("invalid cursor");
    expect(() => decodeAdminAuditCursor(cursor, filter.actorId, {}, { secret: "test", now: 161 })).toThrow("invalid cursor");
    expect(() => decodeAdminAuditCursor(cursor, filter.actorId, { action: "admin.users.browsed" }, { secret: "test", now: 101 })).toThrow("invalid cursor");
  });

  it("derives an audit-specific key from JWT_SECRET", () => {
    process.env.JWT_SECRET = "cursor-root-secret-for-tests-only";
    const cursor = encodeAdminAuditCursor(filter, { createdAt: "2026-09-20T00:00:00.000Z", id: "00000000-0000-4000-8000-000000000002" }, { now: 100 });
    expect(decodeAdminAuditCursor(cursor, filter.actorId, {}, { now: 101 }).filter).toEqual(filter);
    expect(() => decodeAdminUserDirectoryCursor(cursor, { mode: "browse", status: null, query: null, limit: 25 }, { now: 101 })).toThrow("invalid cursor");
  });
});
