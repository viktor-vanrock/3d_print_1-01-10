import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { Permissions } from "../../permissions/public/index.ts";

const secret="step9-authorization-matrix-secret";
const ids={global:randomUUID(),portal:randomUUID(),action:randomUUID(),scoped:randomUUID(),expired:randomUUID(),revoked:randomUUID(),suspended:randomUUID(),blocked:randomUUID(),sanctioned:randomUUID(),legacy:randomUUID(),target:randomUUID()};
let app:NestExpressApplication;let baseUrl:string;
async function bearer(userId:string){const sessionId=randomUUID();await pool.query("insert into browser_sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour')",[sessionId,userId]);return `Bearer ${await new SignJWT({username:`matrix-${userId}`,sv:1}).setProtectedHeader({alg:"HS256"}).setSubject(userId).setJti(sessionId).setExpirationTime("5m").sign(new TextEncoder().encode(secret))}`;}
async function get(path:string,userId?:string){return fetch(`${baseUrl}${path}`,{headers:userId===undefined?{}:{authorization:await bearer(userId)}});}
async function grant(userId:string,permission:Permissions,scope:Readonly<Record<string,string>>={kind:"global"}){await pool.query("insert into permission_grants(user_id,permission,scope,granted_by,reason) values($1,$2,$3,$1,'Step 9 matrix')",[userId,permission,JSON.stringify(scope)]);}

describe.skipIf(!process.env.DATABASE_URL)("Step 9 authorization matrix",()=>{
  beforeAll(async()=>{process.env.JWT_SECRET=secret;const values=Object.values(ids);for(const [index,id] of values.entries())await pool.query("insert into users(id,username,role) values($1,$2,$3)",[id,`matrix-${index}-${id}`,id===ids.legacy?"researcher":"user"]);
    for(const permission of [Permissions.ADMIN_PORTAL_ACCESS,Permissions.USER_VIEW_ANY,Permissions.CATALOG_EDIT_ANY,Permissions.CATALOG_PUBLISH_ANY,Permissions.RESEARCH_MANAGE_PRINTERS])await grant(ids.global,permission);
    await grant(ids.portal,Permissions.ADMIN_PORTAL_ACCESS);await grant(ids.action,Permissions.USER_VIEW_ANY);await grant(ids.scoped,Permissions.CATALOG_EDIT_ANY,{kind:"catalog",catalog:"materials"});
    await pool.query("insert into permission_grants(user_id,permission,granted_by,reason,granted_at,expires_at) values($1,$2,$1,'expired matrix grant',now()-interval '2 hours',now()-interval '1 hour')",[ids.expired,Permissions.USER_VIEW_ANY]);
    await pool.query("insert into permission_grants(user_id,permission,granted_by,reason,revoked_at,revoked_by,revoke_reason) values($1,$2,$1,'revoked matrix grant',now(),$1,'Step 9 revoke')",[ids.revoked,Permissions.USER_VIEW_ANY]);
    for(const actor of [ids.suspended,ids.blocked,ids.sanctioned])await grant(actor,Permissions.USER_VIEW_ANY);
    await pool.query("update users set administrative_state='suspended',administrative_state_changed_at=now(),administrative_state_changed_by=$2,administrative_state_reason='Step 9' where id=$1",[ids.suspended,ids.global]);
    await pool.query("update users set administrative_state='blocked',administrative_state_changed_at=now(),administrative_state_changed_by=$2,administrative_state_reason='Step 9' where id=$1",[ids.blocked,ids.global]);
    await pool.query("update users set status='restricted',administrative_state='active' where id=$1",[ids.sanctioned]);
    await pool.query("insert into sanctions(user_id,type,state,reason_code,starts_at,ends_at,created_by,idempotency_key,idempotency_payload_hash) values($1,'suspension','active','security',now()-interval '1 hour',now()+interval '1 hour',$2,$3,decode(repeat('00',32),'hex'))",[ids.sanctioned,ids.global,`step9-${ids.sanctioned}`]);
    app=await createNestApp(AppModule);await app.listen(0,"127.0.0.1");const address=(app.getHttpServer() as {address():{port:number}|null}).address();if(address===null)throw new Error("matrix server did not bind");baseUrl=`http://127.0.0.1:${address.port}`;
  });
  afterAll(async()=>{await app?.close();const values=Object.values(ids);await pool.query("delete from sanctions where user_id=any($1::uuid[]) or created_by=any($1::uuid[])",[values]);await pool.query("delete from audit_log where actor_user_id=any($1::uuid[])",[values]);await pool.query("delete from browser_sessions where user_id=any($1::uuid[])",[values]);await pool.query("delete from permission_grants where user_id=any($1::uuid[]) or granted_by=any($1::uuid[])",[values]);await pool.query("delete from users where id=any($1::uuid[])",[values]);delete process.env.JWT_SECRET;});

  it("separates the Administration shell from action APIs",async()=>{expect((await get("/v1/admin/me",ids.portal)).status).toBe(200);expect((await get("/v1/admin/users",ids.portal)).status).toBe(403);expect((await get("/v1/admin/me",ids.action)).status).toBe(403);expect((await get("/v1/admin/users",ids.action)).status).toBe(200);});
  it("enforces global endpoint scope and Data domain permissions",async()=>{expect((await get("/data/materials",ids.global)).status).toBe(200);expect((await get("/research/printers",ids.global)).status).toBe(200);expect((await get("/data/materials",ids.scoped)).status).toBe(403);expect((await get("/research/printers",ids.action)).status).toBe(403);});
  it("fails closed for expired, revoked and inactive accounts",async()=>{for(const actor of [ids.expired,ids.revoked])expect((await get("/v1/admin/users",actor)).status).toBe(403);for(const actor of [ids.suspended,ids.blocked,ids.sanctioned])expect((await get("/v1/admin/users",actor)).status).toBe(401);});
  it("keeps an active sanction effective after administrative_state restore",async()=>{const state=await pool.query<{status:string;administrative_state:string;sanctions:string}>("select u.status,u.administrative_state,(select count(*) from sanctions s where s.user_id=u.id and s.state='active')::text sanctions from users u where u.id=$1",[ids.sanctioned]);expect(state.rows[0]).toEqual({status:"restricted",administrative_state:"active",sanctions:"1"});expect((await get("/v1/admin/users",ids.sanctioned)).status).toBe(401);});
  it("never treats a legacy role as authority",async()=>{expect((await get("/v1/admin/me",ids.legacy)).status).toBe(403);expect((await get("/v1/admin/users",ids.legacy)).status).toBe(403);expect((await get("/data/materials",ids.legacy)).status).toBe(403);});
  it("masks the basic user projection server-side",async()=>{const basic=await get(`/v1/admin/users/${ids.target}`,ids.global);expect(basic.status).toBe(200);expect(await basic.text()).not.toMatch(/private\.enc|11111111|identifier_hash|s3_key/i);});
});
