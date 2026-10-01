import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL=process.env.DATABASE_URL;
const ENABLED=process.env.ADMIN_CONFIGURE_ACCESS_SCHEMA_TEST==="1";
const migrationPath=fileURLToPath(new URL("./20260927170000_admin_configure_access.sql",import.meta.url));
function sections(sql:string){const [upSection,down]=sql.split("-- migrate:down");if(upSection===undefined||down===undefined)throw new Error("migration requires up/down");return{up:upSection.replace("-- migrate:up","").trim(),down:down.trim()};}

describe("admin configure access migration",()=>{
  it("adds only the versioned configure_access action and a guarded rollback",async()=>{const sql=await readFile(migrationPath,"utf8");expect(sql).toContain("'configure_access'");expect(sql).toContain("active configure_access confirmation intents");expect(sql).toContain("'rotate_device_credential'");});
  it.skipIf(!DATABASE_URL||!ENABLED)("upgrades, rejects lossy rollback and cleanly replays",async()=>{const pool=new Pool({connectionString:DATABASE_URL});const client=await pool.connect();const {up,down}=sections(await readFile(migrationPath,"utf8"));const actor=randomUUID();const target=randomUUID();try{const database=(await client.query<{name:string}>("select current_database() name")).rows[0]?.name??"";if(!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(database))throw new Error(`refusing schema test against '${database}'`);await client.query("begin");await client.query(down);await client.query(up);await client.query("insert into users(id,username,status) values($1,$2,'active'),($3,$4,'active')",[actor,`actor-${actor}`,target,`target-${target}`]);await client.query(`insert into permission_change_confirmations(id,actor_user_id,target_user_id,session_fingerprint,session_version,action,payload,payload_hash,state_hash,effects,expires_at) values($1,$2,$3,$4,1,'configure_access','{}',$5,$6,'{}',now()+interval '5 minutes')`,[randomUUID(),actor,target,"a".repeat(64),"b".repeat(64),"c".repeat(64)]);await client.query("savepoint lossy");await expect(client.query(down)).rejects.toThrow(/active configure_access/);await client.query("rollback to savepoint lossy");await client.query("delete from permission_change_confirmations where actor_user_id=$1",[actor]);await client.query("delete from users where id=any($1::uuid[])",[[actor,target]]);await client.query(down);await client.query(up);}finally{await client.query("rollback").catch(()=>undefined);client.release();await pool.end();}});
});
