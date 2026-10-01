import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

import { hashPassword } from "../src/modules/auth/public/index.ts";
import { provisionTestUser, resolveTestUserConfig } from "./provision-test-user.ts";

const config = { username: "manual.tester", password: "local-test-password" };

function result<Row extends Record<string, unknown>>(rows: readonly Row[]): QueryResult<Row> {
  return { rows: [...rows], rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function database(query: PoolClient["query"]): Pool {
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return {
    query: vi.fn().mockResolvedValue(result([{ name: "portal_local" }])),
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

describe("provision test user", () => {
  it("rejects non-development and non-local targets before connecting", () => {
    expect(() => resolveTestUserConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://portal:portal@127.0.0.1/portal_local", TEST_USER_USERNAME: config.username, TEST_USER_PASSWORD: config.password })).toThrow("NODE_ENV=development");
    expect(() => resolveTestUserConfig({ NODE_ENV: "development", DATABASE_URL: "postgres://portal:portal@db.example.com/portal_dev", TEST_USER_USERNAME: config.username, TEST_USER_PASSWORD: config.password })).toThrow("only a local");
  });

  it("creates an active ordinary account and password credential without grants", async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
      if (sql.startsWith("select id,role")) return result([]);
      if (sql.startsWith("insert into users")) return result([{ id: "00000000-0000-4000-8000-000000000101" }]);
      return result([]);
    });
    const created = await provisionTestUser(database(query as unknown as PoolClient["query"]), config);
    expect(created).toEqual({ userId: "00000000-0000-4000-8000-000000000101", created: true });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("'user'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("permission_grants"))).toBe(false);
    expect(query.mock.calls.some(([, values]) => Array.isArray(values) && values.includes(config.password))).toBe(false);
  });

  it("is a no-op for the same ordinary account and matching password", async () => {
    const passwordHash = await hashPassword(config.password);
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
      if (sql.startsWith("select id,role")) return result([{ id: "00000000-0000-4000-8000-000000000101", role: "user", status: "active" }]);
      if (sql.startsWith("select password_hash")) return result([{ password_hash: passwordHash }]);
      return result([]);
    });
    await expect(provisionTestUser(database(query as unknown as PoolClient["query"]), config)).resolves.toEqual({
      userId: "00000000-0000-4000-8000-000000000101",
      created: false,
    });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("insert into users"))).toBe(false);
  });

  it("refuses an existing username instead of rotating its password", async () => {
    const passwordHash = await hashPassword("another-password");
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) => {
      if (sql.startsWith("select id,role")) return result([{ id: "00000000-0000-4000-8000-000000000101", role: "user", status: "active" }]);
      if (sql.startsWith("select password_hash")) return result([{ password_hash: passwordHash }]);
      return result([]);
    });
    await expect(provisionTestUser(database(query as unknown as PoolClient["query"]), config)).rejects.toThrow("refuses existing username");
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("update user_password_credentials"))).toBe(false);
  });
});
