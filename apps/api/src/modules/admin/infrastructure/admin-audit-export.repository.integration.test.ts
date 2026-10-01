import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AdminAuditExportPostgresRepository } from "./admin-audit-export.repository.ts";
const databaseUrl=process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("AdminAuditExportPostgresRepository",()=>{
  const pool=new Pool({connectionString:databaseUrl}); const repository=new AdminAuditExportPostgresRepository(pool); const actor=UserId(randomUUID());
  beforeAll(async()=>{const name=(await pool.query<{name:string}>("select current_database() name")).rows[0]?.name??"";if(!/(?:^test_|^sandbox_|^sbx_|_test$|_sandbox$)/.test(name))throw new Error(`refusing export test against '${name}'`);await pool.query("insert into users(id,username) values($1,$2)",[actor,`audit-export-${actor}`]);});
  afterAll(async()=>{await pool.query("delete from admin_audit_exports where actor_user_id=$1",[actor]);await pool.query("delete from audit_log where actor_user_id=$1",[actor]);await pool.query("delete from users where id=$1",[actor]);await pool.end();});
  it("stores payload and creation audit atomically and cleanup is repeatable",async()=>{const payload=Buffer.from("{\"safe\":true}");const now=new Date();const input={id:randomUUID(),actorId:actor,payload,sha256:createHash("sha256").update(payload).digest("hex"),eventCount:0,byteSize:payload.byteLength,truncated:false,createdAt:now,expiresAt:new Date(now.getTime()+60_000),rangeFrom:new Date(now.getTime()-60_000),rangeTo:now};await repository.store(input);expect(await repository.findForDownload(input.id,actor)).toMatchObject({id:input.id,sha256:input.sha256});expect(Number((await pool.query<{count:string}>("select count(*) count from audit_log where action='admin.audit_export.created' and target_id=$1",[input.id])).rows[0]?.count??0)).toBe(1);await pool.query("update admin_audit_exports set created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' where id=$1",[input.id]);const deleted=await Promise.all([repository.deleteExpired(100),repository.deleteExpired(100)]);expect(deleted.reduce((sum,value)=>sum+value,0)).toBe(1);expect(await repository.deleteExpired(100)).toBe(0);});
});
