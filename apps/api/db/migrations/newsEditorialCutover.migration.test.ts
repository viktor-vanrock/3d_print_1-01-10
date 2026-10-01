import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const migrationPath = fileURLToPath(new URL("./20260925160000_news_editorial_cutover.sql", import.meta.url));
const databaseUrl = process.env.DATABASE_URL;
const systemActorId = "00000000-0000-0000-0000-000000000001";

function sections(sql: string): { readonly up: string; readonly down: string } {
  const [up, down] = sql.split("-- migrate:down");
  if (up === undefined || down === undefined) throw new Error("Step 7 migration sections missing");
  return { up: up.replace("-- migrate:up", "").trim(), down: down.trim() };
}

describe("Step 7 News editorial cutover migration", () => {
  it("uses a durable conservative origin marker and a system-managed companion", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("editorial_origin");
    expect(sql).toContain("forge_import");
    expect(sql).toContain("scout_pipeline");
    expect(sql).toContain("manual_admin");
    expect(sql).toContain("feed.news_editor");
    expect(sql).toContain("editorial_origin IS NOT NULL");
    expect(sql).toContain("ingest_provider = 'forge-snapshot'");
    expect(sql).toContain("action = 'news.created'");
    expect(sql).not.toMatch(/ingest_prompt_version\s+like\s+'feed-news%'/i);
    expect(sql).toContain("refusing rollback: Step 7 News provenance or companion grants exist");
  });

  it.skipIf(!databaseUrl || process.env.STEP7_SCHEMA_TEST !== "1")("backfills only proven origins and materializes the assignment companion", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const client = await pool.connect();
    const userId = randomUUID();
    const actorId = randomUUID();
    const forgeId = randomUUID();
    const manualId = randomUUID();
    const unknownId = randomUUID();
    const { up, down } = sections(await readFile(migrationPath, "utf8"));
    try {
      const name = (await client.query<{ name: string }>("select current_database() name")).rows[0]?.name ?? "";
      if (!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name)) throw new Error(`refusing Step 7 migration test against '${name}'`);
      await client.query("begin");
      await client.query(down);
      await client.query(`insert into users(id,username,status) values($1,$2,'active'),($3,$4,'active')`, [userId, `step7-${userId}`, actorId, `step7-${actorId}`]);
      await client.query(
        `insert into feed_posts(id,author_id,type,title,status,source_url,source_fingerprint,ingest_provider,ingest_model,ingest_prompt_version)
         values($1,$4,'text','forge','visible','https://forge.test/news',$5,'forge-snapshot','forge','forge-catalog-2026-09-04'),
               ($2,$4,'text','manual','draft',null,null,null,null,null),
               ($3,$4,'text','unknown','visible','https://remote.test/news',$6,'remote','model','feed-news-unproven')`,
        [forgeId, manualId, unknownId, userId, `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`],
      );
      await client.query(`insert into audit_log(actor_user_id,action,target_type,target_id) values($1,'news.created','feed_post',$2)`, [actorId, manualId]);
      const assignment = (await client.query<{ id: string }>(
        `insert into admin_permission_assignments(user_id,preset_key,preset_version,preset_snapshot,assigned_by,reason)
         values($1,'admin.default',1,'[]'::jsonb,$2,'fixture') returning id`, [userId, actorId],
      )).rows[0];
      expect(assignment).toBeDefined();
      await client.query(`insert into permission_grants(user_id,permission,granted_by,reason) values($1,'feed.manage_news',$2,'fixture')`, [userId, actorId]);
      await client.query(`update users set status='restricted' where id=$1`, [actorId]);
      await client.query(up);
      const origins = await client.query<{ id: string; editorial_origin: string | null }>(`select id,editorial_origin from feed_posts where id=any($1::uuid[]) order by id`, [[forgeId, manualId, unknownId]]);
      expect(new Map(origins.rows.map((row) => [row.id, row.editorial_origin]))).toEqual(new Map([[forgeId, "forge_import"], [manualId, "manual_admin"], [unknownId, null]]));
      const companion = await client.query<{ id: string; granted_by: string }>(
        `select id,granted_by from permission_grants where user_id=$1 and permission='feed.news_editor' and revoked_at is null`,
        [userId],
      );
      expect(companion.rows).toEqual([{ id: expect.any(String), granted_by: systemActorId }]);
      expect((await client.query(`select 1 from admin_permission_assignment_items where assignment_id=$1 and permission='feed.news_editor' and coverage_kind='assignment_grant'`, [assignment?.id])).rowCount).toBe(1);
      const audit = await client.query<{ actor_user_id: string; details: Record<string, unknown> }>(
        `select actor_user_id,details from audit_log where action='permission.granted' and target_type='permission_grant' and target_id=$1`,
        [companion.rows[0]?.id],
      );
      expect(audit.rows).toEqual([{
        actor_user_id: systemActorId,
        details: {
          permission: "feed.news_editor",
          source: "news_editorial_cutover",
          assignment_id: assignment?.id,
          historical_assigned_by: actorId,
        },
      }]);
      await client.query("savepoint rollback_attempt");
      await expect(client.query(down)).rejects.toThrow("refusing rollback");
      await client.query("rollback to savepoint rollback_attempt");
      await client.query(`delete from admin_permission_assignment_items where assignment_id=$1 and permission='feed.news_editor'`, [assignment?.id]);
      await client.query(`delete from audit_log where target_type='permission_grant' and target_id in (select id from permission_grants where user_id=$1 and permission='feed.news_editor')`, [userId]);
      await client.query(`delete from permission_grants where user_id=$1 and permission='feed.news_editor'`, [userId]);
      await client.query(`update feed_posts set editorial_origin=null where id=any($1::uuid[])`, [[forgeId, manualId, unknownId]]);
      await client.query(down);
      await client.query(up);
      expect((await client.query(`select 1 from information_schema.columns where table_schema='public' and table_name='feed_posts' and column_name='editorial_origin'`)).rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
      await pool.end();
    }
  });
});
