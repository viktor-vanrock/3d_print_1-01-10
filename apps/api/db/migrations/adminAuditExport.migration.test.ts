import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
const path = new URL("./20260925120000_admin_audit_export.sql", import.meta.url);
const databaseUrl=process.env.DATABASE_URL;
function sections(sql:string){const [up,down]=sql.split("-- migrate:down");if(up===undefined||down===undefined)throw new Error("migration sections missing");return {up:up.replace("-- migrate:up","").trim(),down:down.trim()};}
describe("admin audit export migration", () => {
  it("adds the permission, bounded owned payload table and safe rollback refusal", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("'audit.export'"); expect(sql).toContain("CREATE TABLE public.admin_audit_exports");
    expect(sql).toContain("byte_size<=5242880"); expect(sql).toContain("event_count<=10000");
    expect(sql).toContain("cannot rollback audit.export while grants exist"); expect(sql).toContain("admin_audit_exports_expiry_idx");
  });
  it.skipIf(!databaseUrl||process.env.STEP8_EXPORT_SCHEMA_TEST!=="1")("replays and refuses rollback while historical grants exist",async()=>{const pool=new Pool({connectionString:databaseUrl});try{const name=(await pool.query<{name:string}>("select current_database() name")).rows[0]?.name??"";if(!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name))throw new Error(`refusing migration test against '${name}'`);const sql=await readFile(path,"utf8");const {up,down}=sections(sql);const user=(await pool.query<{id:string}>("insert into users(username) values($1) returning id",[`audit-export-migration-${Date.now()}`])).rows[0]?.id;if(user===undefined)throw new Error("fixture user missing");await pool.query("insert into permission_grants(user_id,permission,granted_by,reason) values($1,'audit.export',$1,'rollback refusal fixture')",[user]);await expect(pool.query(down)).rejects.toThrow("cannot rollback audit.export while grants exist");await pool.query("delete from permission_grants where user_id=$1",[user]);await pool.query("delete from users where id=$1",[user]);await pool.query(down);await pool.query(up);await pool.query(down);await pool.query(up);expect((await pool.query("select 1 from admin_audit_exports")).rowCount).toBe(0);}finally{await pool.end();}});
});
