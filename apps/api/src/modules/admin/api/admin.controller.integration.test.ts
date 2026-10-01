import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { Permissions } from "../../permissions/public/index.ts";
import { SYSTEM_USER_ID } from "../../_kernel/brandedIds.ts";
import { identifierHash } from "../../auth/infrastructure/auth-crypto.ts";
import { hashPassword } from "../../auth/infrastructure/password-hash.ts";
import { _resetRateLimitStateForTests } from "../../security/application/rate-limit.ts";
import { acquireSuperadminMarkerTestLease } from "../../../test/superadmin-marker-test-lease.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { createResearchApiKeyHash, createResearchApiKeyVerifier, parseResearchApiKey, RESEARCH_API_KEY_PREFIX } from "../../publicapi/infrastructure/research-api-key.ts";

const secret = "admin-me-http-integration-test-secret";
const ids = {
  admin: randomUUID(), user: randomUUID(), portalOnly: randomUUID(), actionOnly: randomUUID(),
  directoryFirst: randomUUID(), directorySecond: randomUUID(), directoryRestricted: randomUUID(),
  step4Target: randomUUID(),
  protectedTarget: randomUUID(),
  opsTarget: randomUUID(),
};
const originalJwtSecret = process.env.JWT_SECRET;
const originalAuthHmacKey = process.env.AUTH_HMAC_KEY;
const originalLookupLimits = {
  user: process.env.RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_USER_PER_MIN,
  ip: process.env.RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_IP_PER_MIN,
  fingerprint: process.env.RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_FINGERPRINT_PER_MIN,
  stepUpUser: process.env.RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_USER_PER_MIN,
  stepUpIp: process.env.RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_IP_PER_MIN,
  stepUpFingerprint: process.env.RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_FINGERPRINT_PER_MIN,
};
const linkedEmail = "identity.lookup@sberbank.ru";
const linkedPlagId = "987654321";
const systemEmail = "identity.system@sberbank.ru";
let app: NestExpressApplication;
let baseUrl: string;
let profileAuth: ProfileAuthPort;
const stepUpPassword = "admin-step-up-integration-password";
const sessionIds = new Map<string, string>();

async function bearer(id: string, username: string): Promise<string> {
  const sessionId = sessionIds.get(id) ?? randomUUID();
  sessionIds.set(id, sessionId);
  await pool.query(
    `insert into browser_sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour') on conflict(id) do nothing`,
    [sessionId, id],
  );
  return `Bearer ${await new SignJWT({ username, sv: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setJti(sessionId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret))}`;
}

async function bearerForSession(id: string, username: string, sessionId: string): Promise<string> {
  return `Bearer ${await new SignJWT({ username, sv: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setJti(sessionId)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret))}`;
}

async function request(path: "me" | "permissions/catalog", id?: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/admin/${path}`, {
    headers: id === undefined ? {} : { authorization: await bearer(id, id === ids.admin ? "admin-me-admin" : "admin-me-user") },
  });
}

async function adminRequest(path: string, id?: string, body?: unknown, authorization?: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/admin/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(authorization !== undefined ? { authorization } : id === undefined ? {} : { authorization: await bearer(id, id === ids.admin ? "admin-me-admin" : "admin-me-user") }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!process.env.DATABASE_URL)("admin me HTTP API", () => {
  let releaseMarkerLease: () => Promise<void> = () => Promise.resolve();
  beforeAll(async () => {
    releaseMarkerLease = await acquireSuperadminMarkerTestLease(pool);
    process.env.JWT_SECRET = secret;
    process.env.AUTH_HMAC_KEY = "admin-identity-lookup-integration-hmac";
    process.env.RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_USER_PER_MIN = "1000";
    process.env.RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_IP_PER_MIN = "1000";
    process.env.RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_FINGERPRINT_PER_MIN = "1000";
    process.env.RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_USER_PER_MIN = "1000";
    process.env.RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_IP_PER_MIN = "1000";
    process.env.RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_FINGERPRINT_PER_MIN = "1000";
    _resetRateLimitStateForTests();
    await pool.query(
      `insert into users(id,username,display_name,status,created_at,updated_at) values
         ($1,$2,null,'active',now(),now()),($3,$4,null,'active',now(),now()),
         ($5,$6,null,'active',now(),now()),($7,$8,null,'active',now(),now()),
         ($9,$10,'Directory First','active','2030-03-01T00:00:00Z','2030-03-02T00:00:00Z'),
         ($11,$12,'Directory Second','active','2030-02-01T00:00:00Z','2030-02-02T00:00:00Z'),
         ($13,$14,'Directory Restricted','restricted','2030-01-01T00:00:00Z','2030-01-02T00:00:00Z'),
         ($15,$16,null,'active',now(),now()),($17,$18,null,'active',now(),now()),
         ($19,$20,null,'active',now(),now()),($21,$22,null,'active',now(),now()),
         ($23,$24,null,'active',now(),now()),($25,$26,'Operations Target','active',now(),now())`,
      [
        ids.admin, `admin-me-admin-${randomUUID()}`,
        ids.user, `admin-me-user-${randomUUID()}`,
        ids.portalOnly, `admin-me-portal-${randomUUID()}`,
        ids.actionOnly, `admin-me-action-${randomUUID()}`,
        ids.directoryFirst, `directory-first-${randomUUID()}`,
        ids.directorySecond, `directory-second-${randomUUID()}`,
        ids.directoryRestricted, `directory-restricted-${randomUUID()}`,
        ids.step4Target, `step4-target-${randomUUID()}`,
        ids.protectedTarget, `protected-target-${randomUUID()}`,
        ids.opsTarget, `ops-target-${randomUUID()}`,
      ],
    );
    await pool.query(`insert into user_password_credentials(user_id,password_hash) values($1,$2)`, [ids.admin, await hashPassword(stepUpPassword)]);
    for (const permission of [
      Permissions.USER_ASSIGN_ADMIN,
      Permissions.USER_REMOVE_ADMIN_ASSIGNMENT,
      Permissions.USER_REVOKE_ALL_ADMIN_ACCESS,
      Permissions.USER_GRANT_PERMISSION,
      Permissions.USER_REVOKE_PERMISSION,
      Permissions.USER_VIEW_PERMISSIONS,
      Permissions.MODERATION_VIEW_SANCTIONS,
      Permissions.USER_VIEW_SESSIONS,
      Permissions.USER_MANAGE_SESSIONS,
      Permissions.USER_SUSPEND,
      Permissions.USER_BLOCK,
      Permissions.USER_RESTORE,
      Permissions.USER_DELETE,
      Permissions.USER_EXPORT,
      Permissions.AUDIT_VIEW_LOG,
      Permissions.AUDIT_EXPORT,
    ]) {
      await pool.query(
        `insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$1,'Step 4 HTTP actor fixture')`,
        [ids.admin, permission],
      );
    }
    await pool.query(
      `insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'pre-existing direct overlap')`,
      [ids.step4Target, Permissions.USER_VIEW_ANY, ids.admin],
    );
    await pool.query(
      `insert into permission_grants(user_id,permission,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason) values
       ($1,$2,$1,'basic card transition',now(),null,null,null,null),
       ($1,$3,$1,'expired sensitive read',now()-interval '2 hours',now()-interval '1 hour',null,null,null)`,
      [ids.user, Permissions.USER_VIEW_ANY, Permissions.USER_VIEW_PERMISSIONS],
    );
    await pool.query(
      `insert into platform_superadmin_identity(identity_key,user_id,binding_mode,bound_at) values('superadmin',$1,'new_installation',now())`,
      [ids.protectedTarget],
    );
    await pool.query(
      `insert into permission_grants(user_id,permission,granted_by,reason,granted_at,expires_at,revoked_at,revoked_by,revoke_reason)
       values
         ($1,$2,$1,'admin access fixture',now(),null,null,null,null),
         ($1,$3,$1,'permission catalog access fixture',now(),null,null,null,null),
         ($1,$4,$1,'catalog fixture',now(),null,null,null,null),
         ($1,$5,$1,'expired fixture',now()-interval '2 hours',now()-interval '1 hour',null,null,null),
         ($1,$6,$1,'revoked fixture',now()-interval '2 hours',null,now()-interval '1 hour',$1,'fixture cleanup'),
         ($1,$11,$1,'user directory fixture',now(),null,null,null,null),
         ($7,$8,$7,'other user fixture',now(),null,null,null,null),
         ($9,$2,$9,'portal-only fixture',now(),null,null,null,null),
         ($10,$3,$10,'action-only fixture',now(),null,null,null,null)`,
      [
        ids.admin,
        Permissions.ADMIN_PORTAL_ACCESS,
        Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
        Permissions.CATALOG_EDIT_ANY,
        Permissions.AUDIT_VIEW_LOG,
        Permissions.AUDIT_EXPORT,
        ids.user,
        Permissions.CATALOG_FEATURE,
        ids.portalOnly,
        ids.actionOnly,
        Permissions.USER_VIEW_ANY,
      ],
    );
    await pool.query(
      `insert into user_identities(user_id,provider,identifier_hash,s3_key) values
         ($1,'email_corp',$2,'identities/test/email.enc'),
         ($1,'plag_id',$3,'identities/test/plag.enc'),
         ($4,'email_corp',$5,'identities/test/system.enc')`,
      [ids.directoryFirst, identifierHash(linkedEmail), identifierHash(linkedPlagId), SYSTEM_USER_ID, identifierHash(systemEmail)],
    );
    await pool.query(
      `insert into sanctions(user_id,type,state,reason_code,reason_note,evidence_url,starts_at,ends_at,created_by,idempotency_key,idempotency_payload_hash,created_at,updated_at)
       select $1::uuid,'suspension','expired','spam','private note','https://private.example/' || seq,
              now()-interval '3 hours',now()-interval '2 hours',$2::uuid,'step5-sanction-' || $1::text || '-' || seq,
              decode(repeat('00',32),'hex'),now()-(seq || ' minutes')::interval,now()-(seq || ' minutes')::interval
         from generate_series(1,51) seq`,
      [ids.directoryFirst, ids.admin],
    );
    app = await createNestApp(AppModule);
    profileAuth = app.get<ProfileAuthPort>(PROFILE_AUTH_PORT);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): { port: number } | null }).address();
    if (address === null) throw new Error("admin test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    const allIds = Object.values(ids);
    await pool.query(`delete from user_identities where user_id=any($1::uuid[]) or identifier_hash=$2`, [allIds, identifierHash(systemEmail)]);
    await pool.query(`delete from sanctions where user_id=any($1::uuid[]) or created_by=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from admin_audit_exports where actor_user_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from audit_log where actor_user_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from permission_change_confirmations where actor_user_id=any($1::uuid[]) or target_user_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from admin_permission_assignment_items where assignment_id in (select id from admin_permission_assignments where user_id=any($1::uuid[]))`, [allIds]);
    await pool.query(`delete from admin_permission_assignments where user_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from platform_superadmin_identity where user_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from permission_grants where user_id=any($1::uuid[]) or granted_by=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from user_password_credentials where user_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from browser_sessions where user_id=any($1::uuid[]) or revoked_by=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from api_keys where owner_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from user_api_keys where user_id=any($1::uuid[])`, [allIds]);
    await pool.query(`delete from users where id=any($1::uuid[])`, [allIds]);
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalAuthHmacKey === undefined) delete process.env.AUTH_HMAC_KEY;
    else process.env.AUTH_HMAC_KEY = originalAuthHmacKey;
    for (const [name, value] of Object.entries({
      RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_USER_PER_MIN: originalLookupLimits.user,
      RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_IP_PER_MIN: originalLookupLimits.ip,
      RATE_LIMIT_ADMIN_IDENTITY_LOOKUP_FINGERPRINT_PER_MIN: originalLookupLimits.fingerprint,
      RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_USER_PER_MIN: originalLookupLimits.stepUpUser,
      RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_IP_PER_MIN: originalLookupLimits.stepUpIp,
      RATE_LIMIT_ADMIN_PERMISSION_STEP_UP_FINGERPRINT_PER_MIN: originalLookupLimits.stepUpFingerprint,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    _resetRateLimitStateForTests();
  });

  afterAll(async () => { await releaseMarkerLease(); });

  it("assigns Admin through password step-up, payload-bound execute and explicit permissions", async () => {
    const authorization = await bearer(ids.admin, "admin-me-admin");
    const mutation = (suffix: string, body: unknown) => fetch(`${baseUrl}/v1/admin/users/${ids.step4Target}/${suffix}`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const preview = await mutation("admin-assignment/preview", {
      reason: "approved through HTTP integration",
    });
    expect(preview.status).toBe(201);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    const intent = await preview.json() as { readonly confirmation_id: string; readonly effects: { readonly added: readonly unknown[] } };
    expect(intent.effects.added).toHaveLength(2);

    const changedPayload = await mutation("admin-assignment/execute", {
      confirmation_id: intent.confirmation_id,
      reason: "changed after preview",
      password: stepUpPassword,
    });
    expect(changedPayload.status).toBe(409);

    const executed = await mutation("admin-assignment/execute", {
      confirmation_id: intent.confirmation_id,
      reason: "approved through HTTP integration",
      password: stepUpPassword,
    });
    expect(executed.status).toBe(201);
    expect(await executed.json()).toMatchObject({ action: "assign_admin", created_grant_ids: expect.any(Array) });

    const access = await adminRequest(`users/${ids.step4Target}/access`, ids.admin);
    expect(access.status).toBe(200);
    expect(access.headers.get("cache-control")).toBe("no-store");
    expect(await access.json()).toMatchObject({
      assignment: { preset_key: "admin.default", preset_version: 2, missing_snapshot_permissions: [] },
      grants: expect.arrayContaining([
        expect.objectContaining({ permission: Permissions.ADMIN_PORTAL_ACCESS, provenance: "admin_assignment" }),
        expect.objectContaining({ permission: Permissions.USER_VIEW_ANY, provenance: "direct" }),
      ]),
    });
    expect(await (await adminRequest(`users/${ids.step4Target}`, ids.admin)).json()).toMatchObject({ role: "admin" });

    const replay = await mutation("admin-assignment/execute", {
      confirmation_id: intent.confirmation_id,
      reason: "approved through HTTP integration",
      password: stepUpPassword,
    });
    expect(replay.status).toBe(409);
  });

  it("keeps the basic card available while each sensitive projection requires its own active permission", async () => {
    const basic = await adminRequest(`users/${ids.directoryFirst}`, ids.user);
    expect(basic.status).toBe(200);
    expect((await adminRequest(`users/${ids.directoryFirst}/access`, ids.user)).status).toBe(403);

    for (const section of ["access", "sanctions"] as const) {
      const response = await adminRequest(`users/${ids.directoryFirst}/${section}`, ids.admin);
      expect(response.status, section).toBe(200);
      expect(response.headers.get("cache-control"), section).toBe("no-store");
      expect(JSON.stringify(await response.json()), section).not.toMatch(/identifier_hash|password_hash|s3_key|reason_note|evidence_url/i);
    }
    const sanctions = await (await adminRequest(`users/${ids.directoryFirst}/sanctions`, ids.admin)).json() as { readonly items: readonly unknown[]; readonly has_earlier: boolean; readonly limit: number };
    expect(sanctions).toMatchObject({ has_earlier: true, limit: 50 });
    expect(sanctions.items).toHaveLength(50);
    expect(JSON.stringify(sanctions)).not.toMatch(/private note|private\.example/i);
    expect((await adminRequest(`users/${ids.directoryFirst}/identities`, ids.admin)).status).toBe(404);
    expect((await adminRequest("users/00000000-0000-0000-0000-000000000001/credentials", ids.admin)).status).toBe(404);
  });

  it("atomically configures role and direct permissions through one confirmed HTTP operation",async()=>{
    const authorization=await bearer(ids.admin,"admin-configure-access");
    const call=(phase:"preview"|"execute",body:unknown)=>fetch(`${baseUrl}/v1/admin/users/${ids.directorySecond}/access/configure/${phase}`,{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify(body)});
    const body={permissions:[Permissions.ADMIN_PORTAL_ACCESS,Permissions.ADMIN_VIEW_PERMISSION_CATALOG,Permissions.USER_VIEW_ANY,Permissions.CATALOG_EDIT_ANY],reason:"combined access editor integration"};
    const preview=await call("preview",body);expect(preview.status).toBe(201);const intent=await preview.json() as {readonly confirmation_id:string};
const execute=await call("execute",{...body,confirmation_id:intent.confirmation_id});expect(execute.status).toBe(201);
    const state=await (await adminRequest(`users/${ids.directorySecond}/access`,ids.admin)).json() as {readonly assignment:unknown;readonly grants:readonly {readonly permission:string;readonly provenance:string}[]};
    expect(state.assignment).toBeNull();expect(state.grants).toEqual(expect.arrayContaining([expect.objectContaining({permission:Permissions.ADMIN_PORTAL_ACCESS}),expect.objectContaining({permission:Permissions.CATALOG_EDIT_ANY,provenance:"direct"})]));
    expect((await call("execute",{...body,password:stepUpPassword,confirmation_id:intent.confirmation_id})).status).toBe(409);
  });

  it("configures News access from permissions without an Admin assignment", async () => {
    const body = {
      permissions: [Permissions.ADMIN_PORTAL_ACCESS, Permissions.ADMIN_VIEW_PERMISSION_CATALOG, Permissions.USER_VIEW_ANY, Permissions.FEED_MANAGE_NEWS],
      reason: "permission-only News access",
    };
    const preview = await adminRequest(`users/${ids.directorySecond}/access/configure/preview`, ids.admin, body);
    expect(preview.status).toBe(201);
    const intent = await preview.json() as { confirmation_id: string };
    const execute = await adminRequest(`users/${ids.directorySecond}/access/configure/execute`, ids.admin, { ...body, confirmation_id: intent.confirmation_id });
    expect(execute.status).toBe(201);
    const state = await (await adminRequest(`users/${ids.directorySecond}/access`, ids.admin)).json() as { assignment: unknown; grants: readonly { permission: string }[] };
    expect(state.assignment).toBeNull();
    expect(state.grants.map((grant) => grant.permission)).toContain(Permissions.FEED_NEWS_EDITOR);
    const revokeBody = { ...body, permissions: body.permissions.filter((permission) => permission !== Permissions.FEED_MANAGE_NEWS) };
    const revokePreview = await adminRequest(`users/${ids.directorySecond}/access/configure/preview`, ids.admin, revokeBody);
    expect(revokePreview.status).toBe(201);
    const revokeIntent = await revokePreview.json() as { confirmation_id: string };
    expect((await adminRequest(`users/${ids.directorySecond}/access/configure/execute`, ids.admin, { ...revokeBody, confirmation_id: revokeIntent.confirmation_id })).status).toBe(201);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [ids.directorySecond, Permissions.FEED_NEWS_EDITOR])).rowCount).toBe(0);
  });

  it("browses bounded masked audit pages and rechecks permission on every page", async () => {
    const targetId = ids.directoryFirst;
    await pool.query(
      `insert into audit_log(actor_user_id,action,target_type,target_id,details,created_at) values
       ($1,'material.updated','material',$2,$3,now()-interval '2 minutes'),
       ($1,'material.updated','material',$2,$4,now()-interval '3 minutes')`,
      [ids.admin, targetId, JSON.stringify({ outcome: "success", status: "password=secret", count: 2, secret: "never-return" }), JSON.stringify({ outcome: "failure", count: 1 })],
    );
    expect((await adminRequest("audit/events", ids.user)).status).toBe(403);
    const before = Number((await pool.query<{ count: string }>(`select count(*) count from audit_log where actor_user_id=$1 and action='admin.audit.browsed'`, [ids.admin])).rows[0]?.count ?? 0);
    const first = await adminRequest(`audit/events?limit=1&target_id=${targetId}&action=material.updated`, ids.admin);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const firstBody = await first.json() as { items: readonly { metadata: Record<string, unknown>; details_masked: boolean }[]; next_cursor: string; range: { from: string; to: string } };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]).toMatchObject({ metadata: { outcome: "success", count: 2 }, details_masked: true });
    expect(JSON.stringify(firstBody)).not.toMatch(/password=secret|never-return/);
    expect(new Date(firstBody.range.to).getTime() - new Date(firstBody.range.from).getTime()).toBe(31 * 24 * 60 * 60 * 1000);
    const after = Number((await pool.query<{ count: string }>(`select count(*) count from audit_log where actor_user_id=$1 and action='admin.audit.browsed'`, [ids.admin])).rows[0]?.count ?? 0);
    expect(after - before).toBe(1);
    expect((await adminRequest("audit/events?from=2026-01-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z", ids.admin)).status).toBe(400);
    expect((await adminRequest(`audit/events?cursor=${encodeURIComponent(firstBody.next_cursor)}&action=admin.user.viewed`, ids.admin)).status).toBe(400);

    const grant = await pool.query<{ id: string }>(`select id from permission_grants where user_id=$1 and permission=$2 and revoked_at is null and expires_at is null order by granted_at desc limit 1`, [ids.admin, Permissions.AUDIT_VIEW_LOG]);
    const grantId = grant.rows[0]?.id;
    if (grantId === undefined) throw new Error("active audit grant missing");
    await pool.query(`update permission_grants set revoked_at=now(),revoked_by=$1,revoke_reason='integration check' where id=$2`, [ids.admin, grantId]);
    expect((await adminRequest(`audit/events?cursor=${encodeURIComponent(firstBody.next_cursor)}`, ids.admin)).status).toBe(403);
    await pool.query(`update permission_grants set revoked_at=null,revoked_by=null,revoke_reason=null where id=$1`, [grantId]);
    const second = await adminRequest(`audit/events?cursor=${encodeURIComponent(firstBody.next_cursor)}`, ids.admin);
    expect(second.status).toBe(200);
    expect(JSON.stringify(await second.json())).not.toMatch(/never-return|password=secret/);
  });

  it("does not return 200 when mandatory audit-of-read persistence fails", async () => {
    await pool.query(`create or replace function test_fail_audit_browse() returns trigger language plpgsql as $$ begin if new.action='admin.audit.browsed' then raise exception 'audit browse unavailable'; end if; return new; end $$`);
    await pool.query(`create trigger test_fail_audit_browse before insert on audit_log for each row execute function test_fail_audit_browse()`);
    try {
      expect((await adminRequest("audit/events", ids.admin)).status).toBe(500);
    } finally {
      await pool.query(`drop trigger if exists test_fail_audit_browse on audit_log`);
      await pool.query(`drop function if exists test_fail_audit_browse()`);
    }
  });

  it("creates and downloads a bounded masked audit export and rechecks both permissions", async () => {
    const now = new Date(); const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const createdResponse = await adminRequest("audit/exports", ids.admin, { from: from.toISOString(), to: now.toISOString(), action: "material.updated" });
    expect(createdResponse.status).toBe(201); expect(createdResponse.headers.get("cache-control")).toBe("no-store");
    const created = await createdResponse.json() as { id: string; sha256: string; download_url: string };
    const grant = await pool.query<{ id: string }>("select id from permission_grants where user_id=$1 and permission=$2 and revoked_at is null", [ids.admin, Permissions.AUDIT_EXPORT]);
    const grantId = grant.rows[0]?.id; if (grantId === undefined) throw new Error("audit export grant missing");
    await pool.query("update permission_grants set revoked_at=now(),revoked_by=$1,revoke_reason='test' where id=$2", [ids.admin, grantId]);
    expect((await adminRequest(`audit/exports/${created.id}/download`, ids.admin)).status).toBe(403);
    await pool.query("update permission_grants set revoked_at=null,revoked_by=null,revoke_reason=null where id=$1", [grantId]);
    const download = await adminRequest(`audit/exports/${created.id}/download`, ids.admin); expect(download.status).toBe(200);
    const bytes = Buffer.from(await download.arrayBuffer()); expect(createHash("sha256").update(bytes).digest("hex")).toBe(created.sha256);
    expect(bytes.toString("utf8")).not.toMatch(/password=secret|never-return/);
    expect(Number((await pool.query<{ count: string }>("select count(*) count from audit_log where actor_user_id=$1 and action='admin.audit_export.download_started' and target_id=$2", [ids.admin, created.id])).rows[0]?.count ?? 0)).toBe(1);
  });

  it("covers remove, revoke-all and direct-revoke negative matrix with server effects", async () => {
    const authorization = await bearer(ids.admin, "admin-me-admin");
    const call = (targetId: string, suffix: string, body: unknown, auth = authorization) => fetch(
      `${baseUrl}/v1/admin/users/${targetId}/${suffix}`,
      { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    const deniedAuthorization = await bearer(ids.user, "admin-me-user");
    expect((await call(ids.step4Target, "admin-assignment/remove/preview", { reason: "denied" }, deniedAuthorization)).status).toBe(403);
    expect((await call(ids.admin, "admin-assignment/preview", { reason: "self elevation" })).status).toBe(403);
    expect((await call(ids.protectedTarget, "admin-assignment/preview", { reason: "protected target" })).status).toBe(403);
    expect((await call(ids.step4Target, "permissions/grant/preview", {
      reason: "delegation ceiling",
      permission: Permissions.CATALOG_FEATURE,
      expires_at: null,
    })).status).toBe(403);

    const stalePreview = await call(ids.step4Target, "admin-assignment/remove/preview", { reason: "stale removal" });
    expect(stalePreview.status).toBe(201);
    const staleIntent = await stalePreview.json() as { readonly confirmation_id: string };
    const directGrant = await pool.query<{ id: string }>(
      `insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'concurrent state change') returning id`,
      [ids.step4Target, Permissions.CATALOG_EDIT_ANY, ids.admin],
    );
    expect((await call(ids.step4Target, "admin-assignment/remove/execute", {
      confirmation_id: staleIntent.confirmation_id,
      reason: "stale removal",
      password: stepUpPassword,
    })).status).toBe(409);

    const removePreview = await call(ids.step4Target, "admin-assignment/remove/preview", { reason: "remove assignment only" });
    const removeIntent = await removePreview.json() as {
      readonly confirmation_id: string;
      readonly effects: { readonly revoked: readonly unknown[]; readonly retained: readonly { readonly permission: string }[] };
    };
    expect(removeIntent.effects.revoked).toHaveLength(2);
    expect(removeIntent.effects.retained.map((item) => item.permission)).toEqual(expect.arrayContaining([
      Permissions.USER_VIEW_ANY,
      Permissions.CATALOG_EDIT_ANY,
    ]));
    const removeBody = { confirmation_id: removeIntent.confirmation_id, reason: "remove assignment only", password: stepUpPassword };
    const concurrent = await Promise.all([
      call(ids.step4Target, "admin-assignment/remove/execute", removeBody),
      call(ids.step4Target, "admin-assignment/remove/execute", removeBody),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);

    const grantId = directGrant.rows[0]?.id;
    if (grantId === undefined) throw new Error("direct grant fixture was not created");
    const revokePreview = await call(ids.step4Target, "permissions/revoke/preview", {
      reason: "remove direct catalog access",
      grant_id: grantId,
    });
    expect(revokePreview.status).toBe(201);
    const revokeIntent = await revokePreview.json() as { readonly confirmation_id: string; readonly effects: { readonly revoked: readonly { readonly grant_id: string }[] } };
    expect(revokeIntent.effects.revoked).toEqual([expect.objectContaining({ grant_id: grantId })]);
    const revokeBody = {
      confirmation_id: revokeIntent.confirmation_id,
      reason: "remove direct catalog access",
      password: stepUpPassword,
      grant_id: grantId,
    };
    expect((await call(ids.step4Target, "permissions/revoke/execute", revokeBody)).status).toBe(201);
    expect((await call(ids.step4Target, "permissions/revoke/execute", revokeBody)).status).toBe(409);

    const assignPreview = await call(ids.step4Target, "admin-assignment/preview", { reason: "reassign for revoke all" });
    const assignIntent = await assignPreview.json() as { readonly confirmation_id: string };
    expect((await call(ids.step4Target, "admin-assignment/execute", {
      confirmation_id: assignIntent.confirmation_id,
      reason: "reassign for revoke all",
      password: stepUpPassword,
    })).status).toBe(201);
    await pool.query(
      `insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'ordinary research access')`,
      [ids.step4Target, Permissions.RESEARCH_MANAGE_PRINTERS, ids.admin],
    );
    const revokeAllPreview = await call(ids.step4Target, "admin-access/revoke-all/preview", { reason: "remove all administrative access" });
    const revokeAllIntent = await revokeAllPreview.json() as {
      readonly confirmation_id: string;
      readonly effects: { readonly revoked: readonly { readonly permission: string }[]; readonly retained: readonly { readonly permission: string }[] };
    };
    expect(revokeAllIntent.effects.retained.map((item) => item.permission)).toContain(Permissions.RESEARCH_MANAGE_PRINTERS);
    expect(revokeAllIntent.effects.revoked.map((item) => item.permission)).toContain(Permissions.ADMIN_PORTAL_ACCESS);
    expect((await call(ids.step4Target, "admin-access/revoke-all/execute", {
      confirmation_id: revokeAllIntent.confirmation_id,
      reason: "remove all administrative access",
      password: stepUpPassword,
    })).status).toBe(201);
    const access = await adminRequest(`users/${ids.step4Target}/access`, ids.admin);
    const accessBody = await access.json() as { readonly assignment: unknown; readonly grants: readonly { readonly permission: string }[] };
    expect(accessBody.assignment).toBeNull();
    expect(accessBody.grants.map((grant) => grant.permission)).toEqual([Permissions.RESEARCH_MANAGE_PRINTERS]);

    const expiredPreview = await call(ids.step4Target, "permissions/grant/preview", {
      reason: "expired confirmation",
      permission: Permissions.CATALOG_EDIT_ANY,
      expires_at: null,
    });
    const expiredIntent = await expiredPreview.json() as { readonly confirmation_id: string };
    await pool.query(
      `update permission_change_confirmations set created_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes' where id=$1`,
      [expiredIntent.confirmation_id],
    );
    expect((await call(ids.step4Target, "permissions/grant/execute", {
      confirmation_id: expiredIntent.confirmation_id,
      reason: "expired confirmation",
      password: stepUpPassword,
      permission: Permissions.CATALOG_EDIT_ANY,
      expires_at: null,
    })).status).toBe(409);
  });

  it("returns 401 without session and 403 without admin.portal.access", async () => {
    expect((await request("me")).status).toBe(401);
    expect((await request("me", ids.user)).status).toBe(403);
  });

  it("enforces portal access and action permission independently", async () => {
    expect((await request("me", ids.portalOnly)).status).toBe(200);
    expect((await request("permissions/catalog", ids.portalOnly)).status).toBe(403);
    expect((await request("me", ids.actionOnly)).status).toBe(403);
    expect((await request("permissions/catalog", ids.actionOnly)).status).toBe(200);
    expect((await request("me", ids.admin)).status).toBe(200);
    expect((await request("permissions/catalog", ids.admin)).status).toBe(200);
    expect((await request("me", ids.user)).status).toBe(403);
    expect((await request("permissions/catalog", ids.user)).status).toBe(403);
  });

  it("returns only own active permissions and records the read audit", async () => {
    const response = await request("me", ids.admin);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      user_id: ids.admin,
      permissions: [
        { key: Permissions.ADMIN_PORTAL_ACCESS, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.ADMIN_VIEW_PERMISSION_CATALOG, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.AUDIT_EXPORT, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.AUDIT_VIEW_LOG, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.CATALOG_EDIT_ANY, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.MODERATION_VIEW_SANCTIONS, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_ASSIGN_ADMIN, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_BLOCK, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_DELETE, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_EXPORT, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_GRANT_PERMISSION, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_MANAGE_SESSIONS, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_REMOVE_ADMIN_ASSIGNMENT, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_RESTORE, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_REVOKE_ALL_ADMIN_ACCESS, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_REVOKE_PERMISSION, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_SUSPEND, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_VIEW_ANY, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_VIEW_PERMISSIONS, scope: { kind: "global" }, expires_at: null },
        { key: Permissions.USER_VIEW_SESSIONS, scope: { kind: "global" }, expires_at: null },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("fixture");

    const audit = await pool.query<{ details: { permission_count?: unknown } }>(
      `select details from audit_log
       where actor_user_id=$1 and action='admin.me.viewed' and target_type='user' and target_id=$1
       order by created_at desc limit 1`,
      [ids.admin],
    );
    expect(audit.rows[0]?.details.permission_count).toBe(21);
  });

  it("protects permission catalog independently, returns metadata and records audit", async () => {
    expect((await request("permissions/catalog")).status).toBe(401);
    expect((await request("permissions/catalog", ids.user)).status).toBe(403);

    const response = await request("permissions/catalog", ids.admin);
    expect(response.status).toBe(200);
    const body = await response.json() as { readonly items?: readonly Record<string, unknown>[] };
    expect(body.items).toHaveLength(Object.values(Permissions).length);
    expect(body.items?.[0]).toEqual({
      key: Permissions.ADMIN_PORTAL_ACCESS,
      category: "admin",
      description: "Access the administrative workspace",
      risk: "low",
      delegable: true,
      admin_assignable: true,
      allowed_scope_kinds: ["global"],
      confirmation: "none",
    });

    const audit = await pool.query<{ details: { permission_count?: unknown } }>(
      `select details from audit_log
       where actor_user_id=$1 and action='admin.permissions_catalog.viewed'
         and target_type='permission_catalog' and target_id=$1
       order by created_at desc limit 1`,
      [ids.admin],
    );
    expect(audit.rows[0]?.details.permission_count).toBe(Object.values(Permissions).length);
  });

  it("protects browsing, search and card with user.view_any and never accepts free text in GET", async () => {
    expect((await adminRequest("users")).status).toBe(401);
    expect((await adminRequest("users", ids.actionOnly)).status).toBe(403);
    expect((await adminRequest("users/search", ids.actionOnly, { query: "Directory" })).status).toBe(403);
    expect((await adminRequest(`users/${ids.directoryFirst}`, ids.actionOnly)).status).toBe(403);
    expect((await adminRequest("users?query=Directory", ids.admin)).status).toBe(422);
    expect((await adminRequest("users/search", ids.admin, { query: "   " })).status).toBe(422);
  });

  it("browses with bounded keyset pagination, masking and no-store responses", async () => {
    const firstResponse = await adminRequest("users?status=active&limit=1", ids.admin);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("cache-control")).toBe("no-store");
    const first = await firstResponse.json() as { readonly items: readonly Record<string, unknown>[]; readonly next_cursor: string | null };
    expect(first.items).toEqual([{
      id: ids.directoryFirst,
      username: expect.stringMatching(/^directory-first-/),
      display_name: "Directory First",
      role: "user",
      account_state: "active",
      status: "active",
      created_at: "2030-03-01T00:00:00.000Z",
      pii_masked: true,
    }]);
    expect(first.next_cursor).toEqual(expect.any(String));
    expect(JSON.stringify(first)).not.toContain("identifier_hash");
    expect(JSON.stringify(first)).not.toContain("s3_key");

    const secondResponse = await adminRequest(`users?status=active&limit=1&cursor=${encodeURIComponent(first.next_cursor ?? "")}`, ids.admin);
    const second = await secondResponse.json() as { readonly items: readonly { readonly id: string }[] };
    expect(second.items[0]?.id).toBe(ids.directorySecond);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("searches names and UUID through a POST body, filters status and never audits the query", async () => {
    const byName = await adminRequest("users/search", ids.admin, { query: "Directory Restricted", status: "restricted" });
    expect(byName.status).toBe(200);
    expect(byName.headers.get("cache-control")).toBe("no-store");
    expect(await byName.json()).toMatchObject({ items: [{ id: ids.directoryRestricted, status: "restricted", pii_masked: true }] });

    const byId = await adminRequest("users/search", ids.admin, { query: ids.directorySecond });
    expect(await byId.json()).toMatchObject({ items: [{ id: ids.directorySecond }] });
    const audit = await pool.query<{ details: Record<string, unknown> }>(
      `select details from audit_log where actor_user_id=$1 and action='admin.users.searched' order by created_at desc limit 1`,
      [ids.admin],
    );
    expect(audit.rows[0]?.details).toMatchObject({ query_kind: "uuid", pii_masked: true });
    expect(JSON.stringify(audit.rows[0]?.details)).not.toContain(ids.directorySecond);
  });

  it("returns a masked basic card, hides the system user directly and audits both outcomes", async () => {
    const response = await adminRequest(`users/${ids.directoryFirst}`, ids.admin);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: ids.directoryFirst,
      username: expect.stringMatching(/^directory-first-/),
      display_name: "Directory First",
      role: "user",
      account_state: "active",
      status: "active",
      created_at: "2030-03-01T00:00:00.000Z",
      updated_at: "2030-03-02T00:00:00.000Z",
      pii_masked: true,
    });
    expect((await adminRequest(`users/${SYSTEM_USER_ID}`, ids.admin)).status).toBe(404);
    const audits = await pool.query<{ details: { outcome?: unknown } }>(
      `select details from audit_log where actor_user_id=$1 and action='admin.user.viewed' order by created_at`,
      [ids.admin],
    );
    expect(audits.rows.map((row) => row.details.outcome)).toEqual(expect.arrayContaining(["success", "not_found"]));
  });

  it("does not expose the retired identity lookup endpoint", async () => {
    expect((await adminRequest("users/lookup-identity", ids.admin, { provider: "email_corp", identifier: linkedEmail })).status).toBe(404);
  });

  it("executes session revocation and confirms retired admin API-key endpoints stay absent", async () => {
    const call = (path: string, body: unknown) => adminRequest(path, ids.admin, body);
    const targetAuthorization = await bearer(ids.opsTarget, "ops-target");
    const selectedSession = sessionIds.get(ids.opsTarget)!;
    const otherSession = randomUUID();
    await pool.query(`insert into browser_sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour')`, [otherSession, ids.opsTarget]);
    const otherAuthorization = await bearerForSession(ids.opsTarget, "ops-target", otherSession);
    const keyId = randomUUID();
    const userKeyId = randomUUID();
    const researchKeyId = randomUUID();
    const outOfScopeKeyId = randomUUID();
    const publicSecret = `mf_pub_${randomBytes(24).toString("base64url")}`;
    const unrelatedPublicSecret = `mf_pub_${randomBytes(24).toString("base64url")}`;
    const unrelatedPublicKeyId = randomUUID();
    await pool.query(
      `insert into api_keys(id,owner_id,name,key_prefix,key_hash,scopes) values($1,$2,'integration','mf_pub_old',$3,array['read'])`,
      [keyId, ids.opsTarget, createHash("sha256").update(publicSecret).digest()],
    );
    await pool.query(
      `insert into api_keys(id,owner_id,name,key_prefix,key_hash,scopes) values($1,$2,'unrelated','mf_pub_other',$3,array['read'])`,
      [unrelatedPublicKeyId, ids.opsTarget, createHash("sha256").update(unrelatedPublicSecret).digest()],
    );
    const userSecret = `mf_user_${randomBytes(24).toString("base64url")}`;
    const unrelatedUserSecret = `mf_user_${randomBytes(24).toString("base64url")}`;
    const unrelatedUserKeyId = randomUUID();
    const researchSecret = `${RESEARCH_API_KEY_PREFIX}${randomBytes(16).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
    const parsedResearch = parseResearchApiKey(researchSecret);
    if (parsedResearch === null) throw new Error("research fixture generation failed");
    await pool.query(
      `insert into user_api_keys(id,user_id,scope,scopes,label,key_prefix,key_hash) values
       ($1,$2,'public_api',array['read'],'user integration','mf_user_fixture',$3),
       ($4,$2,'research',array['write'],'research integration',$5,$6),
       ($7,$2,'feed_ingest',array['write'],'ingest credential','ingest_fixture',$8),
       ($9,$2,'public_api',array['read'],'unrelated user','mf_user_other',$10)`,
      [userKeyId, ids.opsTarget, createHash("sha256").update(userSecret).digest(), researchKeyId, parsedResearch.publicId, await createResearchApiKeyHash(researchSecret), outOfScopeKeyId, Buffer.alloc(32, 4), unrelatedUserKeyId, createHash("sha256").update(unrelatedUserSecret).digest()],
    );
    const visibleKeys = await adminRequest(`users/${ids.opsTarget}/api-keys`, ids.admin);
    expect(visibleKeys.status).toBe(404);

    const sessionPreview = await call(`users/${ids.opsTarget}/sessions/${selectedSession}/revoke/preview`, { reason: "selected session review" });
    expect(sessionPreview.status).toBe(201);
    const sessionIntent = await sessionPreview.json() as { confirmation_id: string };
    const sessionExecute = await call(`users/${ids.opsTarget}/sessions/${selectedSession}/revoke/execute`, { reason: "selected session review", password: stepUpPassword, confirmation_id: sessionIntent.confirmation_id });
    expect(sessionExecute.status).toBe(201);
    expect((await pool.query(`select revoked_at from browser_sessions where id=$1`, [selectedSession])).rows[0]?.revoked_at).not.toBeNull();
    expect((await pool.query(`select revoked_at from browser_sessions where id=$1`, [otherSession])).rows[0]?.revoked_at).toBeNull();
    expect((await adminRequest("users", ids.opsTarget)).status).toBe(401);
    expect((await fetch(`${baseUrl}/auth/session`, { headers: { authorization: otherAuthorization } })).status).toBe(200);

    const publicAuth = (raw: string) => fetch(`${baseUrl}/v0/printers`, { headers: { authorization: `Bearer ${raw}` } });
    expect((await publicAuth(publicSecret)).status).toBe(200);
    expect((await publicAuth(unrelatedPublicSecret)).status).toBe(200);
    expect((await publicAuth(userSecret)).status).toBe(200);
    expect((await publicAuth(unrelatedUserSecret)).status).toBe(200);
    expect((await fetch(`${baseUrl}/v0/printers/${randomUUID()}/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${userSecret}`, "content-type": "application/json", "idempotency-key": "step6-user-scope" },
      body: JSON.stringify({ command: "stop" }),
    })).status).toBe(403);
    const researchVerifier = createResearchApiKeyVerifier(pool, profileAuth);
    expect((await researchVerifier.verify(researchSecret)).status).toBe("authenticated");

    const rotatePreview = await call(`users/${ids.opsTarget}/api-keys/${keyId}/rotate/preview`, { reason: "scheduled key rotation" });
    expect(rotatePreview.status).toBe(404);
    if (rotatePreview.status === 404) return;
    const rotateIntent = await rotatePreview.json() as { confirmation_id: string };
    const [firstRotate, concurrentReplay] = await Promise.all([
      call(`users/${ids.opsTarget}/api-keys/${keyId}/rotate/execute`, { reason: "scheduled key rotation", password: stepUpPassword, confirmation_id: rotateIntent.confirmation_id }),
      call(`users/${ids.opsTarget}/api-keys/${keyId}/rotate/execute`, { reason: "scheduled key rotation", password: stepUpPassword, confirmation_id: rotateIntent.confirmation_id }),
    ]);
    expect([firstRotate.status, concurrentReplay.status].sort()).toEqual([201, 409]);
    const successfulRotation = firstRotate.status === 201 ? firstRotate : concurrentReplay;
    const failedReplay = firstRotate.status === 409 ? firstRotate : concurrentReplay;
    const rotationBody = await successfulRotation.json() as { secret?: string; key_prefix?: string };
    expect(typeof rotationBody.secret === "string" && rotationBody.secret.startsWith("mf_pub_")).toBe(true);
    const rotatedPublicSecret = rotationBody.secret;
    if (rotatedPublicSecret === undefined) throw new Error("rotation response omitted one-time secret");
    expect((await publicAuth(publicSecret)).status).toBe(401);
    expect((await publicAuth(rotatedPublicSecret)).status).toBe(200);
    expect((await publicAuth(unrelatedPublicSecret)).status).toBe(200);
    const replayBody = await failedReplay.json();
    expect(JSON.stringify(replayBody)).not.toContain("mf_pub_");
    expect((await pool.query(`select consumed_at is not null as consumed from permission_change_confirmations where id=$1`, [rotateIntent.confirmation_id])).rows[0]?.consumed).toBe(true);
    expect((await pool.query(`select count(*)::int as count from audit_log where action='admin.rotate_api_key.executed' and details->>'confirmation_id'=$1`, [rotateIntent.confirmation_id])).rows[0]?.count).toBe(1);
    expect(JSON.stringify(rotationBody)).not.toContain("mf_pub_old");

    const lostResponsePreview = await call(`users/${ids.opsTarget}/api-keys/${keyId}/rotate/preview`, { reason: "replace lost rotation response" });
    const lostResponseIntent = await lostResponsePreview.json() as { confirmation_id: string };
    const replacementRotation = await call(`users/${ids.opsTarget}/api-keys/${keyId}/rotate/execute`, { reason: "replace lost rotation response", password: stepUpPassword, confirmation_id: lostResponseIntent.confirmation_id });
    const replacementBody = await replacementRotation.json() as { secret?: string };
    expect(typeof replacementBody.secret === "string" && replacementBody.secret.startsWith("mf_pub_")).toBe(true);
    if (replacementBody.secret === undefined) throw new Error("replacement rotation omitted one-time secret");
    expect((await publicAuth(rotatedPublicSecret)).status).toBe(401);
    expect((await publicAuth(replacementBody.secret)).status).toBe(200);

    const researchPreview = await call(`users/${ids.opsTarget}/api-keys/${researchKeyId}/rotate/preview`, { reason: "research credential rotation" });
    const researchIntent = await researchPreview.json() as { confirmation_id: string };
    const researchRotation = await call(`users/${ids.opsTarget}/api-keys/${researchKeyId}/rotate/execute`, { reason: "research credential rotation", password: stepUpPassword, confirmation_id: researchIntent.confirmation_id });
    const researchBody = await researchRotation.json() as { secret?: string };
    expect(typeof researchBody.secret === "string" && researchBody.secret.startsWith(RESEARCH_API_KEY_PREFIX)).toBe(true);
    if (researchBody.secret === undefined) throw new Error("research rotation omitted one-time secret");
    expect((await researchVerifier.verify(researchSecret)).status).toBe("invalid");
    expect((await researchVerifier.verify(researchBody.secret)).status).toBe("authenticated");
    const userKeyPreview = await call(`users/${ids.opsTarget}/api-keys/${userKeyId}/rotate/preview`, { reason: "user key rotation" });
    const userKeyIntent = await userKeyPreview.json() as { confirmation_id: string };
    const userRotation = await call(`users/${ids.opsTarget}/api-keys/${userKeyId}/rotate/execute`, { reason: "user key rotation", password: stepUpPassword, confirmation_id: userKeyIntent.confirmation_id });
    expect(userRotation.status).toBe(201);
    const userRotationBody = await userRotation.json() as { secret?: string };
    expect(typeof userRotationBody.secret === "string" && userRotationBody.secret.startsWith("mf_user_")).toBe(true);
    if (userRotationBody.secret === undefined) throw new Error("user rotation omitted one-time secret");
    expect((await publicAuth(userSecret)).status).toBe(401);
    expect((await publicAuth(userRotationBody.secret)).status).toBe(200);
    expect((await publicAuth(unrelatedUserSecret)).status).toBe(200);
    expect((await pool.query(`select status from user_api_keys where id=$1`, [outOfScopeKeyId])).rows[0]?.status).toBe("active");

    const exportPreview = await call(`users/${ids.opsTarget}/export/preview`, { reason: "support metadata snapshot" });
    const exportIntent = await exportPreview.json() as { confirmation_id: string };
    const exported = await call(`users/${ids.opsTarget}/export/execute`, { reason: "support metadata snapshot", confirmation_id: exportIntent.confirmation_id });
    expect(exported.status).toBe(201);
    const exportBody = await exported.json();
    expect(exportBody).toMatchObject({ kind: "administrative_account_metadata_snapshot", limits: { sessions: 50, api_keys: 50 } });
    const serializedExport = JSON.stringify(exportBody);
    expect([publicSecret, unrelatedPublicSecret, userSecret, userRotationBody.secret, unrelatedUserSecret, researchSecret, researchBody.secret, replacementBody.secret].some((value) => value !== undefined && serializedExport.includes(value))).toBe(false);
    const persistedSecurityMetadata = JSON.stringify((await pool.query(
      `select payload from permission_change_confirmations where target_user_id=$1
       union all select details from audit_log where target_id=$1`,
      [ids.opsTarget],
    )).rows);
    expect([publicSecret, unrelatedPublicSecret, userSecret, userRotationBody.secret, unrelatedUserSecret, researchSecret, researchBody.secret, replacementBody.secret, stepUpPassword].some((value) => value !== undefined && persistedSecurityMetadata.includes(value))).toBe(false);
    const subsequentReads = JSON.stringify(await (await adminRequest(`users/${ids.opsTarget}/api-keys`, ids.admin)).json());
    expect([publicSecret, unrelatedPublicSecret, userSecret, userRotationBody.secret, unrelatedUserSecret, researchSecret, researchBody.secret, replacementBody.secret].some((value) => value !== undefined && subsequentReads.includes(value))).toBe(false);

    const suspendPreview = await call(`users/${ids.opsTarget}/account/suspend/preview`, { reason: "security containment" });
    const suspendIntent = await suspendPreview.json() as { confirmation_id: string };
    expect((await call(`users/${ids.opsTarget}/account/suspend/execute`, { reason: "security containment", confirmation_id: suspendIntent.confirmation_id })).status).toBe(403);
    expect((await call(`users/${ids.opsTarget}/account/suspend/execute`, { reason: "security containment", password: stepUpPassword, confirmation_id: suspendIntent.confirmation_id })).status).toBe(201);
    expect((await pool.query(`select administrative_state from users where id=$1`, [ids.opsTarget])).rows[0]?.administrative_state).toBe("suspended");
    expect((await pool.query(`select revoked_at from api_keys where id=$1`, [keyId])).rows[0]?.revoked_at).not.toBeNull();
    void targetAuthorization;
  });

  it("covers Step 6 permission, stale-state, protected-target, sanction restore and audit rollback negatives", async () => {
    const call = (path: string, body: unknown, actorId = ids.admin) => adminRequest(path, actorId, body);
    expect((await call(`users/${ids.opsTarget}/account/block/preview`, { reason: "denied" }, ids.user)).status).toBe(403);
    expect((await call(`users/${ids.protectedTarget}/account/block/preview`, { reason: "protected" })).status).toBe(403);

    await pool.query(`update users set administrative_state='active',administrative_state_changed_at=null,administrative_state_changed_by=null,administrative_state_reason=null where id=$1`, [ids.opsTarget]);
    const stale = await call(`users/${ids.opsTarget}/account/block/preview`, { reason: "stale preview" });
    const staleIntent = await stale.json() as { confirmation_id: string };
    await pool.query(`insert into browser_sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour')`, [randomUUID(), ids.opsTarget]);
    expect((await call(`users/${ids.opsTarget}/account/block/execute`, { reason: "stale preview", password: stepUpPassword, confirmation_id: staleIntent.confirmation_id })).status).toBe(409);

    await pool.query(`create function test_fail_step6_audit() returns trigger language plpgsql as $$ begin if new.action='admin.block_account.executed' then raise exception 'forced Step 6 audit failure'; end if; return new; end $$`);
    await pool.query(`create trigger test_fail_step6_audit before insert on audit_log for each row execute function test_fail_step6_audit()`);
    try {
      const preview = await call(`users/${ids.opsTarget}/account/block/preview`, { reason: "audit rollback" });
      const intent = await preview.json() as { confirmation_id: string };
      expect((await call(`users/${ids.opsTarget}/account/block/execute`, { reason: "audit rollback", password: stepUpPassword, confirmation_id: intent.confirmation_id })).status).toBe(500);
      expect((await pool.query(`select administrative_state from users where id=$1`, [ids.opsTarget])).rows[0]?.administrative_state).toBe("active");
      expect((await pool.query(`select consumed_at from permission_change_confirmations where id=$1`, [intent.confirmation_id])).rows[0]?.consumed_at).toBeNull();
    } finally {
      await pool.query(`drop trigger test_fail_step6_audit on audit_log`);
      await pool.query(`drop function test_fail_step6_audit()`);
    }

    await pool.query(
      `insert into sanctions(user_id,type,state,reason_code,starts_at,created_by,idempotency_key,idempotency_payload_hash)
       values($1,'suspension','active','security',now(),$2,$3,decode(repeat('11',32),'hex'))`,
      [ids.opsTarget, ids.admin, `step6-active-${randomUUID()}`],
    );
    await pool.query(`update users set administrative_state='blocked',administrative_state_changed_at=now(),administrative_state_changed_by=$2,administrative_state_reason='fixture' where id=$1`, [ids.opsTarget, ids.admin]);
    const restore = await call(`users/${ids.opsTarget}/account/restore/preview`, { reason: "administrative review" });
    const restoreIntent = await restore.json() as { confirmation_id: string };
    expect((await call(`users/${ids.opsTarget}/account/restore/execute`, { reason: "administrative review", password: stepUpPassword, confirmation_id: restoreIntent.confirmation_id })).status).toBe(201);
    expect((await pool.query(`select state from sanctions where user_id=$1 and state='active'`, [ids.opsTarget])).rowCount).toBe(1);
    sessionIds.delete(ids.opsTarget);
    expect((await adminRequest("users", ids.opsTarget)).status).toBe(401);

    const close = await call(`users/${ids.opsTarget}/account/close/preview`, { reason: "approved closure" });
    const closeIntent = await close.json() as { confirmation_id: string };
    expect((await call(`users/${ids.opsTarget}/account/close/execute`, { reason: "approved closure", password: stepUpPassword, confirmation_id: closeIntent.confirmation_id })).status).toBe(201);
    const restoreClosed = await call(`users/${ids.opsTarget}/account/restore/preview`, { reason: "must remain closed" });
    const restoreClosedIntent = await restoreClosed.json() as { confirmation_id: string };
    expect((await call(`users/${ids.opsTarget}/account/restore/execute`, { reason: "must remain closed", password: stepUpPassword, confirmation_id: restoreClosedIntent.confirmation_id })).status).toBe(409);
  });
});
