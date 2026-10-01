import { readFile } from "node:fs/promises";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PermissionGrantAlreadyActiveError } from "../domain/permission-grant.ts";
import { Permissions } from "../domain/permissions.catalog.ts";
import { PermissionGrantsPgRepository } from "./permission-grants.repository.ts";

function result(rows: QueryResultRow[] = [], rowCount = rows.length): QueryResult<QueryResultRow> {
  return { rows, rowCount, command: "", oid: 0, fields: [] };
}

function transactionalRepository(results: Array<QueryResult<QueryResultRow> | Error>) {
  const query = vi.fn<(text: string, params?: readonly unknown[]) => Promise<QueryResult<QueryResultRow>>>(() => {
    const outcome = results.shift() ?? result();
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(() => Promise.resolve(client)) } as unknown as Pool;
  return { repository: new PermissionGrantsPgRepository(pool), query, release };
}

const userId = UserId("00000000-0000-4000-8000-000000000001");
const bootstrapInput = {
  userId,
  permissions: [Permissions.CATALOG_EDIT_ANY],
  reason: "bootstrap test",
};

describe("PermissionGrantsPgRepository", () => {
  it("читает только неотозванные и неистёкшие grants", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          user_id: "00000000-0000-4000-8000-000000000001",
          permission: Permissions.AUDIT_VIEW_LOG,
          scope: { kind: "global" },
          granted_by: "00000000-0000-4000-8000-000000000002",
          reason: "Проверка",
          granted_at: new Date("2026-01-01T00:00:00.000Z"),
          expires_at: null,
          revoked_at: null,
          revoked_by: null,
          revoke_reason: null,
        },
      ],
    });
    const repository = new PermissionGrantsPgRepository({ query } as never);
    const now = new Date("2026-02-01T00:00:00.000Z");

    const grants = await repository.findActiveGrants({
      userId: UserId("00000000-0000-4000-8000-000000000001"),
      permission: Permissions.AUDIT_VIEW_LOG,
      now,
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("revoked_at is null and (expires_at is null or expires_at>$3)"), [
      "00000000-0000-4000-8000-000000000001",
      Permissions.AUDIT_VIEW_LOG,
      now,
    ]);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.userId).toBe("00000000-0000-4000-8000-000000000001");
    expect(grants[0]?.scope).toEqual({ kind: "global" });
  });

  it("fail-closed отклоняет некорректный scope из БД", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          user_id: "00000000-0000-4000-8000-000000000001",
          permission: Permissions.AUDIT_VIEW_LOG,
          scope: {},
          granted_by: "00000000-0000-4000-8000-000000000002",
          reason: "Проверка",
          granted_at: new Date("2026-01-01T00:00:00.000Z"),
          expires_at: null,
          revoked_at: null,
          revoked_by: null,
          revoke_reason: null,
        },
      ],
    });
    const repository = new PermissionGrantsPgRepository({ query } as never);

    await expect(
      repository.findActiveGrants({ userId, permission: Permissions.AUDIT_VIEW_LOG, now: new Date("2026-02-01T00:00:00.000Z") }),
    ).rejects.toThrow("Invalid permission grant scope");
  });

  it("читает typed grant по id", async () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000003",
      user_id: "00000000-0000-4000-8000-000000000001",
      permission: Permissions.CATALOG_EDIT_ANY,
      scope: { kind: "global" },
      granted_by: "00000000-0000-4000-8000-000000000002",
      reason: "Проверка",
      granted_at: new Date("2026-01-01T00:00:00.000Z"),
      expires_at: null,
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null,
    };
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const repository = new PermissionGrantsPgRepository({ query } as never);

    await expect(repository.findById(row.id)).resolves.toMatchObject({
      id: row.id,
      permission: Permissions.CATALOG_EDIT_ANY,
      scope: { kind: "global" },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("where id=$1"), [row.id]);
  });

  it("читает все active grants пользователя в стабильном порядке", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PermissionGrantsPgRepository({ query } as never);
    const now = new Date("2026-02-01T00:00:00.000Z");

    await expect(repository.findAllActiveGrants({ userId, now })).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/revoked_at is null[\s\S]*expires_at>[\s\S]*order by permission,scope::text,expires_at nulls last,id/),
      [userId, now],
    );
  });

  it("записывает admin.me.viewed audit с количеством permissions", async () => {
    const query = vi.fn().mockResolvedValue(result());
    const repository = new PermissionGrantsPgRepository({ query } as never);

    await repository.recordAdminMeViewed({ actorId: userId, permissionCount: 2 });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'admin.me.viewed'"),
      expect.arrayContaining([userId, JSON.stringify({ permission_count: 2 })]),
    );
  });

  it("записывает admin.permissions_catalog.viewed audit с количеством permissions", async () => {
    const query = vi.fn().mockResolvedValue(result());
    const repository = new PermissionGrantsPgRepository({ query } as never);

    await repository.recordAdminPermissionCatalogViewed({ actorId: userId, permissionCount: 33 });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'admin.permissions_catalog.viewed'"),
      expect.arrayContaining([userId, JSON.stringify({ permission_count: 33 })]),
    );
  });

  it("считает активным только пользователя со status active", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const repository = new PermissionGrantsPgRepository({ query } as never);

    await expect(repository.isUserActive(UserId("00000000-0000-4000-8000-000000000001"))).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("identity_read_v1"), ["00000000-0000-4000-8000-000000000001"]);
  });

  it("сериализует bootstrap по userId и пропускает существующий активный grant", async () => {
    const { repository, query, release } = transactionalRepository([result(), result(), result([{}]), result(), result([{}]), result()]);

    await expect(repository.ensureBootstrapPermissions(bootstrapInput)).resolves.toEqual({ created: 0, skipped: 1 });

    expect(query.mock.calls.map((call) => String(call[0]).trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtextextended($1,0))",
      "select 1 from",
      "select pg_advisory_xact_lock(hashtextextended($1,0))",
      "select 1 from",
      "commit",
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual([`permissions.bootstrap:${userId}`]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("создаёт отсутствующий grant и audit в одной транзакции", async () => {
    const grantId = "00000000-0000-4000-8000-000000000002";
    const { repository, query } = transactionalRepository([result(), result(), result([{}]), result(), result(), result([{ id: grantId }]), result(), result()]);

    await expect(repository.ensureBootstrapPermissions(bootstrapInput)).resolves.toEqual({ created: 1, skipped: 0 });

    const sql = query.mock.calls.map((call) => String(call[0]));
    expect(sql).toEqual([
      "begin",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("identity_read_all_v1"),
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("from permission_grants"),
      expect.stringContaining("insert into permission_grants"),
      expect.stringContaining("insert into audit_log"),
      "commit",
    ]);
  });

  it("откатывает grant, если audit insert завершился ошибкой", async () => {
    const auditFailure = new Error("audit unavailable");
    const { repository, query, release } = transactionalRepository([
      result(),
      result(),
      result([{}]),
      result(),
      result(),
      result([{ id: "00000000-0000-4000-8000-000000000002" }]),
      auditFailure,
      result(),
    ]);

    await expect(repository.ensureBootstrapPermissions(bootstrapInput)).rejects.toBe(auditFailure);

    expect(String(query.mock.calls.at(-2)?.[0])).toContain("insert into audit_log");
    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(query.mock.calls.some((call) => call[0] === "commit")).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("сериализует обычную выдачу и не создаёт дублирующий active grant или audit", async () => {
    const { repository, query, release } = transactionalRepository([result(), result(), result([{}]), result()]);

    await expect(
      repository.createWithAudit({
        userId,
        permission: Permissions.CATALOG_EDIT_ANY,
        scope: { kind: "global" },
        grantedBy: UserId("00000000-0000-4000-8000-000000000002"),
        reason: "duplicate test",
        expiresAt: null,
      }),
    ).rejects.toBeInstanceOf(PermissionGrantAlreadyActiveError);

    const sql = query.mock.calls.map((call) => String(call[0]));
    expect(sql).toEqual([
      "begin",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("from permission_grants"),
      "rollback",
    ]);
    expect(sql.some((statement) => statement.includes("insert into permission_grants"))).toBe(false);
    expect(sql.some((statement) => statement.includes("insert into audit_log"))).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("откатывает bootstrap для отсутствующего или удалённого пользователя", async () => {
    const { repository, query } = transactionalRepository([result(), result(), result(), result()]);

    await expect(repository.ensureBootstrapPermissions(bootstrapInput)).rejects.toThrow("Bootstrap permissions require a non-deleted user");

    expect(query.mock.calls.at(-1)?.[0]).toBe("rollback");
    expect(query.mock.calls.some((call) => String(call[0]).includes("insert into permission_grants"))).toBe(false);
  });

  it("не обращается напрямую к physical users table", async () => {
    const source = await readFile(new URL("./permission-grants.repository.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:from|join)\s+(?:public\.)?users\b/i);
  });
});
