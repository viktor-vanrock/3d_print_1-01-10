import type { Pool, PoolClient } from "pg";
import { pathToFileURL } from "node:url";

import { pool } from "../src/db/client.ts";
import { hashPassword, verifyPassword } from "../src/modules/auth/public/index.ts";
import { isValidUsername } from "../src/modules/profile/public/index.ts";

const MIN_PASSWORD_LENGTH = 8;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PROTECTED_DATABASES = new Set(["portal", "postgres", "template0", "template1"]);

type ProvisionPool = Pick<Pool, "connect" | "query">;

interface TestUserConfig {
  readonly username: string;
  readonly password: string;
}

export interface ProvisionTestUserResult {
  readonly userId: string;
  readonly created: boolean;
}

export function resolveTestUserConfig(environment: NodeJS.ProcessEnv): TestUserConfig {
  if (environment.NODE_ENV !== "development") throw new Error("test user provisioning requires NODE_ENV=development");
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("test user provisioning requires DATABASE_URL");

  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("test user provisioning requires a valid DATABASE_URL");
  }
  if (!LOCAL_HOSTS.has(target.hostname)) throw new Error("test user provisioning accepts only a local PostgreSQL host");

  const username = environment.TEST_USER_USERNAME ?? "";
  const password = environment.TEST_USER_PASSWORD ?? "";
  if (username !== username.trim().toLowerCase() || !isValidUsername(username)) {
    throw new Error("TEST_USER_USERNAME must contain 3-32 lowercase letters, digits, or dots");
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 1024) {
    throw new Error(`TEST_USER_PASSWORD must contain ${MIN_PASSWORD_LENGTH}-1024 characters`);
  }
  return { username, password };
}

async function assertDatabaseIsSafe(database: ProvisionPool): Promise<void> {
  const result = await database.query<{ readonly name: string }>("select current_database() as name");
  const name = result.rows[0]?.name;
  if (!name) throw new Error("test user provisioning could not identify the database");
  if (PROTECTED_DATABASES.has(name)) throw new Error(`test user provisioning rejects protected database '${name}'`);
}

async function existingCredential(client: PoolClient, userId: string): Promise<string | null> {
  const result = await client.query<{ readonly password_hash: string }>(
    "select password_hash from user_password_credentials where user_id=$1 for update",
    [userId],
  );
  return result.rows[0]?.password_hash ?? null;
}

export async function provisionTestUser(database: ProvisionPool, config: TestUserConfig): Promise<ProvisionTestUserResult> {
  await assertDatabaseIsSafe(database);
  const client = await database.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ readonly id: string; readonly role: string; readonly status: string }>(
      "select id,role,status from users where username=$1 for update",
      [config.username],
    );
    const account = existing.rows[0];
    if (account) {
      const credential = await existingCredential(client, account.id);
      const passwordMatches = credential === null ? false : await verifyPassword(config.password, credential);
      const grants = await client.query("select 1 from permission_grants where user_id=$1 limit 1", [account.id]);
      if (account.role !== "user" || account.status !== "active" || credential === null || !passwordMatches || grants.rowCount !== 0) {
        throw new Error(`test user provisioning refuses existing username '${config.username}'`);
      }
      await client.query("commit");
      return { userId: account.id, created: false };
    }

    const passwordHash = await hashPassword(config.password);
    const created = await client.query<{ readonly id: string }>(
      `insert into users(username,status,handle_confirmed,role)
       values($1,'active',true,'user') returning id`,
      [config.username],
    );
    const userId = created.rows[0]?.id;
    if (!userId) throw new Error("test user provisioning returned no user id");
    await client.query("insert into user_password_credentials(user_id,password_hash) values($1,$2)", [userId, passwordHash]);
    await client.query("commit");
    return { userId, created: true };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  const result = await provisionTestUser(pool, resolveTestUserConfig(process.env));
  console.log(`test user ${result.created ? "created" : "already exists"}: username=${process.env.TEST_USER_USERNAME} user_id=${result.userId}`);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  run()
    .then(() => pool.end())
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.message : "test user provisioning failed");
      await pool.end().catch(() => undefined);
      process.exitCode = 1;
    });
}
