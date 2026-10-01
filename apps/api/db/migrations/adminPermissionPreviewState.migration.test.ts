import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const ENABLED = process.env.ADMIN_PERMISSION_PREVIEW_STATE_SCHEMA_TEST === "1";
const migrationPath = fileURLToPath(new URL("./20260924190000_permission_change_preview_state.sql", import.meta.url));

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [upSection, down] = sql.split("-- migrate:down");
  if (upSection === undefined || down === undefined) throw new Error("preview-state migration must contain up and down sections");
  return { up: upSection.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("admin permission preview-state migration", () => {
  it("keeps sensitive input out of the schema migration and guards lossy rollback", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("state_hash");
    expect(sql).toContain("effects");
    expect(sql).toContain("refusing rollback");
    expect(sql).not.toMatch(/password|identifier_hash/i);
  });

  it.skipIf(!DATABASE_URL || !ENABLED)("supports up/down replay and refuses rollback with state-bound intents", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    const actorId = randomUUID();
    const targetId = randomUUID();
    try {
      const database = (await client.query<{ name: string }>("select current_database() name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(database)) throw new Error(`refusing schema test against '${database}'`);
      await client.query("begin");
      await client.query(down);
      await client.query(up);
      await client.query(`insert into users(id,username,status) values($1,$2,'active'),($3,$4,'active')`, [
        actorId, `preview-actor-${actorId}`, targetId, `preview-target-${targetId}`,
      ]);
      await client.query(
        `insert into permission_change_confirmations
          (actor_user_id,target_user_id,session_fingerprint,session_version,action,payload,payload_hash,state_hash,effects,expires_at)
         values($1,$2,$3,1,'assign_admin',$4::jsonb,$5,$6,$7::jsonb,now()+interval '5 minutes')`,
        [
          actorId,
          targetId,
          "a".repeat(64),
          JSON.stringify({ action: "assign_admin", reason: "stored only in protected payload" }),
          createHash("sha256").update("payload").digest("hex"),
          createHash("sha256").update("state").digest("hex"),
          JSON.stringify({ added: [], revoked: [], retained: [] }),
        ],
      );
      await client.query("savepoint guarded_down");
      await expect(client.query(down)).rejects.toThrow(/refusing rollback/);
      await client.query("rollback to savepoint guarded_down");
      await client.query(`delete from permission_change_confirmations where actor_user_id=$1`, [actorId]);
      await client.query(`delete from users where id=any($1::uuid[])`, [[actorId, targetId]]);
      await client.query(down);
      await client.query(up);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
