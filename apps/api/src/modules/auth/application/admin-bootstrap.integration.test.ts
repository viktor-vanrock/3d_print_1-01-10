import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../../../db/client.ts";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { PermissionGrantsPgRepository } from "../../permissions/infrastructure/permission-grants.repository.ts";
import { PermissionsService } from "../../permissions/application/permissions.service.ts";
import { ALL_PERMISSIONS, Permissions, SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS, SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS } from "../../permissions/domain/permissions.catalog.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { hashPassword, verifyPassword } from "../infrastructure/password-hash.ts";
import { AdminBootstrapService } from "./admin-bootstrap.service.ts";
import { acquireSuperadminMarkerTestLease } from "../../../test/superadmin-marker-test-lease.ts";
import { Pool } from "pg";

const users: string[] = [];
const isolatedUsers: string[] = [];
const isolatedDatabaseUrl = process.env.ADMIN_BOOTSTRAP_NEW_INSTALLATION_DATABASE_URL;
const isolatedPool = isolatedDatabaseUrl === undefined ? null : new Pool({ connectionString: isolatedDatabaseUrl });
let releaseMarkerLease: () => Promise<void> = () => Promise.resolve();

beforeAll(async () => { releaseMarkerLease = await acquireSuperadminMarkerTestLease(pool); });
afterAll(async () => { await releaseMarkerLease(); await isolatedPool?.end(); });

function service(input: { readonly username: string; readonly password: string }, database = pool) {
  return new AdminBootstrapService(
    new ConfigService({
      ADMIN_USERNAME: input.username,
      ADMIN_PASSWORD: input.password,
    }),
    database,
    new AuthRepository(database),
    new PermissionsService(new PermissionGrantsPgRepository(database)),
    { info: vi.fn() } as unknown as RuntimeLogger,
  );
}

async function existingCandidate(input: { readonly withEvidence: boolean }): Promise<{ readonly id: string; readonly userId: string; readonly username: string }> {
  const id = randomUUID();
  const username = `sa.${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  users.push(id);
  await pool.query(`insert into users(id,username,status,handle_confirmed,session_version) values($1,$2,'active',true,7)`, [id, username]);
  await pool.query(`insert into user_password_credentials(user_id,password_hash) values($1,$2)`, [id, await hashPassword("initial-superadmin-password")]);
  if (input.withEvidence) {
    for (const permission of SUPERADMIN_BINDING_ROOT_EVIDENCE_PERMISSIONS) {
      await pool.query(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason)
         values($1,$2,'{"kind":"global"}'::jsonb,$1,'automatic bootstrap root access')`,
        [id, permission],
      );
    }
    for (const permission of SUPERADMIN_BINDING_DATA_EVIDENCE_PERMISSIONS) {
      await pool.query(
        `insert into permission_grants(user_id,permission,scope,granted_by,reason)
         values($1,$2,'{"kind":"global"}'::jsonb,$1,'automatic bootstrap data workspace access')`,
        [id, permission],
      );
    }
  }
  return { id, userId: id, username };
}

afterEach(async () => {
  if (isolatedPool !== null && isolatedUsers.length > 0) {
    await isolatedPool.query(`delete from platform_superadmin_identity where user_id=any($1::uuid[])`, [isolatedUsers]);
    await isolatedPool.query(`delete from permission_grants where user_id=any($1::uuid[]) or granted_by=any($1::uuid[])`, [isolatedUsers]);
    await isolatedPool.query(`delete from user_password_credentials where user_id=any($1::uuid[])`, [isolatedUsers]);
    await isolatedPool.query(`update users set status='deleted' where id=any($1::uuid[]) and exists (select 1 from audit_log where audit_log.actor_user_id=users.id)`, [isolatedUsers]);
    await isolatedPool.query(`delete from users where id=any($1::uuid[]) and not exists (select 1 from audit_log where audit_log.actor_user_id=users.id)`, [isolatedUsers.splice(0)]);
  }
  if (users.length === 0) return;
  await pool.query(`delete from platform_superadmin_identity where user_id=any($1::uuid[])`, [users]);
  await pool.query(`delete from permission_grants where user_id=any($1::uuid[]) or granted_by=any($1::uuid[])`, [users]);
  await pool.query(`delete from user_password_credentials where user_id=any($1::uuid[])`, [users]);
  await pool.query(`update users set status='deleted' where id=any($1::uuid[]) and exists (select 1 from audit_log where audit_log.actor_user_id=users.id)`, [users]);
  await pool.query(`delete from users where id=any($1::uuid[]) and not exists (select 1 from audit_log where audit_log.actor_user_id=users.id)`, [users.splice(0)]);
});

describe("Superadmin bootstrap transaction", () => {
  it.skipIf(isolatedPool === null)("generates and persists one UUID only on a verified new installation", async () => {
    const username = `sa.${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await service({ username, password: "new-superadmin-password" }, isolatedPool!).onApplicationBootstrap();
    const id = (await isolatedPool!.query<{ user_id: string }>(`select user_id from platform_superadmin_identity where identity_key='superadmin'`)).rows[0]!.user_id;
    isolatedUsers.push(id);
    expect((await isolatedPool!.query(`select username,session_version from users where id=$1`, [id])).rows[0]).toMatchObject({ username, session_version: 1 });
    expect((await isolatedPool!.query(`select binding_mode from platform_superadmin_identity where user_id=$1`, [id])).rows[0]?.binding_mode).toBe("new_installation");
    expect((await isolatedPool!.query(`select count(*)::int count from permission_grants where user_id=$1 and revoked_at is null`, [id])).rows[0]?.count).toBe(ALL_PERMISSIONS.length);
  });

  it.skipIf(isolatedPool === null)("rolls account, credential, marker and grants back when grant audit fails", async () => {
    const username = `sa.${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await isolatedPool!.query(`create function test_fail_superadmin_grant_audit() returns trigger language plpgsql as $$ begin if new.action='permission.granted' then raise exception 'forced grant audit failure'; end if; return new; end $$`);
    await isolatedPool!.query(`create trigger test_fail_superadmin_grant_audit before insert on audit_log for each row execute function test_fail_superadmin_grant_audit()`);
    try {
      await expect(service({ username, password: "new-superadmin-password" }, isolatedPool!).onApplicationBootstrap()).rejects.toThrow("forced grant audit failure");
      expect((await isolatedPool!.query(`select 1 from users where username=$1`, [username])).rowCount).toBe(0);
      expect((await isolatedPool!.query(`select 1 from platform_superadmin_identity`)).rowCount).toBe(0);
    } finally {
      await isolatedPool!.query(`drop trigger test_fail_superadmin_grant_audit on audit_log`);
      await isolatedPool!.query(`drop function test_fail_superadmin_grant_audit()`);
    }
  });

  it.skipIf(isolatedPool === null)("rolls account, credential, marker, grants and grant audit back when lifecycle audit fails", async () => {
    const username = `sa.${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await isolatedPool!.query(`create function test_fail_superadmin_lifecycle_audit() returns trigger language plpgsql as $$ begin if new.action='superadmin.identity.bound' then raise exception 'forced lifecycle audit failure'; end if; return new; end $$`);
    await isolatedPool!.query(`create trigger test_fail_superadmin_lifecycle_audit before insert on audit_log for each row execute function test_fail_superadmin_lifecycle_audit()`);
    try {
      await expect(service({ username, password: "new-superadmin-password" }, isolatedPool!).onApplicationBootstrap()).rejects.toThrow("forced lifecycle audit failure");
      expect((await isolatedPool!.query(`select 1 from users where username=$1`, [username])).rowCount).toBe(0);
      expect((await isolatedPool!.query(`select 1 from platform_superadmin_identity`)).rowCount).toBe(0);
    } finally {
      await isolatedPool!.query(`drop trigger test_fail_superadmin_lifecycle_audit on audit_log`);
      await isolatedPool!.query(`drop function test_fail_superadmin_lifecycle_audit()`);
    }
  });

  it.skipIf(isolatedPool === null)("serializes concurrent first startup without duplicate identity or grants", async () => {
    const username = `sa.${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await Promise.all([
      service({ username, password: "new-superadmin-password" }, isolatedPool!).onApplicationBootstrap(),
      service({ username, password: "new-superadmin-password" }, isolatedPool!).onApplicationBootstrap(),
    ]);
    const id = (await isolatedPool!.query<{ user_id: string }>(`select user_id from platform_superadmin_identity`)).rows[0]!.user_id;
    isolatedUsers.push(id);
    expect((await isolatedPool!.query(`select count(*)::int count from platform_superadmin_identity where user_id=$1`, [id])).rows[0]?.count).toBe(1);
    expect((await isolatedPool!.query(`select count(*)::int count from permission_grants where user_id=$1 and revoked_at is null`, [id])).rows[0]?.count).toBe(ALL_PERMISSIONS.length);
  });

  it("binds only a proven existing bootstrap account and makes the next restart a no-op", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    const afterBinding = await pool.query<{ username: string; session_version: number; password_hash: string }>(
      `select users.username,users.session_version,credentials.password_hash
         from users join user_password_credentials credentials on credentials.user_id=users.id where users.id=$1`,
      [candidate.id],
    );
    await pool.query(`update users set username=$2 where id=$1`, [candidate.id, `renamed-${randomUUID()}`]);
    const auditBefore = await pool.query<{ count: string }>(`select count(*) count from audit_log where actor_user_id=$1`, [candidate.id]);
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    const afterRestart = await pool.query<{ session_version: number; password_hash: string }>(
      `select users.session_version,credentials.password_hash
         from users join user_password_credentials credentials on credentials.user_id=users.id where users.id=$1`,
      [candidate.id],
    );
    const auditAfter = await pool.query<{ count: string }>(`select count(*) count from audit_log where actor_user_id=$1`, [candidate.id]);
    expect(afterRestart.rows[0]?.session_version).toBe(afterBinding.rows[0]?.session_version);
    expect(afterRestart.rows[0]?.password_hash).toBe(afterBinding.rows[0]?.password_hash);
    expect(auditAfter.rows[0]?.count).toBe(auditBefore.rows[0]?.count);
    expect((await pool.query(`select user_id from platform_superadmin_identity where identity_key='superadmin'`)).rows[0]?.user_id).toBe(candidate.id);
  });

  it("rejects an arbitrary existing user and rolls the marker back", async () => {
    const candidate = await existingCandidate({ withEvidence: false });
    await expect(service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap()).rejects.toThrow("binding evidence is incomplete");
    expect((await pool.query(`select 1 from platform_superadmin_identity where user_id=$1`, [candidate.id])).rowCount).toBe(0);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1`, [candidate.id])).rowCount).toBe(0);
  });

  it("rejects a wrong password before binding the proven bootstrap account", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await expect(service({ username: candidate.username, password: "wrong-password-value" }).onApplicationBootstrap())
      .rejects.toThrow("binding evidence is incomplete");
    expect((await pool.query(`select 1 from platform_superadmin_identity`)).rowCount).toBe(0);
  });

  it("fails closed when an original bootstrap evidence grant is missing", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await pool.query(`delete from permission_grants where user_id=$1 and permission=$2`, [candidate.id, Permissions.USER_VIEW_ANY]);
    await expect(service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap())
      .rejects.toThrow("binding evidence is incomplete");
    expect((await pool.query(`select 1 from platform_superadmin_identity`)).rowCount).toBe(0);
  });

  it("checks exact original root keys rather than accepting the same grant count", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await pool.query(`delete from permission_grants where user_id=$1 and permission=$2`, [candidate.id, Permissions.USER_VIEW_ANY]);
    await pool.query(
      `insert into permission_grants(user_id,permission,scope,granted_by,reason)
       values($1,$2,'{"kind":"global"}'::jsonb,$1,'automatic bootstrap root access')`,
      [candidate.id, Permissions.ADMIN_PORTAL_ACCESS],
    );
    await expect(service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap())
      .rejects.toThrow("binding evidence is incomplete");
    expect((await pool.query(`select 1 from platform_superadmin_identity`)).rowCount).toBe(0);
  });

  it("fails closed when an original bootstrap evidence grant was revoked", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await pool.query(
      `update permission_grants set revoked_at=now(),revoked_by=$1,revoke_reason='security review'
        where user_id=$1 and permission=$2 and revoked_at is null`,
      [candidate.id, Permissions.CATALOG_EDIT_ANY],
    );
    await expect(service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap())
      .rejects.toThrow("binding evidence is incomplete");
    expect((await pool.query(`select 1 from platform_superadmin_identity`)).rowCount).toBe(0);
  });

  it("rotates the credential and invalidates sessions exactly once", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    await service({ username: candidate.username, password: "rotated-superadmin-password" }).onApplicationBootstrap();
    const rotated = await pool.query<{ session_version: number; password_hash: string }>(
      `select users.session_version,credentials.password_hash
         from users join user_password_credentials credentials on credentials.user_id=users.id where users.id=$1`,
      [candidate.id],
    );
    expect(rotated.rows[0]?.session_version).toBe(8);
    await expect(verifyPassword("rotated-superadmin-password", rotated.rows[0]!.password_hash)).resolves.toBe(true);
    expect((await pool.query(`select 1 from audit_log where actor_user_id=$1 and action='superadmin.credential.rotated'`, [candidate.id])).rowCount).toBe(1);
  });

  it("rolls a failed password rotation and session invalidation back together", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    await pool.query(`create function test_fail_superadmin_rotation_audit() returns trigger language plpgsql as $$ begin if new.action='superadmin.credential.rotated' then raise exception 'forced rotation audit failure'; end if; return new; end $$`);
    await pool.query(`create trigger test_fail_superadmin_rotation_audit before insert on audit_log for each row execute function test_fail_superadmin_rotation_audit()`);
    try {
      await expect(service({ username: candidate.username, password: "rotated-superadmin-password" }).onApplicationBootstrap()).rejects.toThrow("forced rotation audit failure");
      const unchanged = await pool.query<{ session_version: number; password_hash: string }>(
        `select users.session_version,credentials.password_hash
           from users join user_password_credentials credentials on credentials.user_id=users.id where users.id=$1`,
        [candidate.id],
      );
      expect(unchanged.rows[0]?.session_version).toBe(7);
      await expect(verifyPassword("initial-superadmin-password", unchanged.rows[0]!.password_hash)).resolves.toBe(true);
      await expect(verifyPassword("rotated-superadmin-password", unchanged.rows[0]!.password_hash)).resolves.toBe(false);
    } finally {
      await pool.query(`drop trigger test_fail_superadmin_rotation_audit on audit_log`);
      await pool.query(`drop function test_fail_superadmin_rotation_audit()`);
    }
  });

  it("serializes concurrent password rotation into one session invalidation", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    await Promise.all([
      service({ username: candidate.username, password: "rotated-superadmin-password" }).onApplicationBootstrap(),
      service({ username: candidate.username, password: "rotated-superadmin-password" }).onApplicationBootstrap(),
    ]);
    expect((await pool.query(`select session_version from users where id=$1`, [candidate.id])).rows[0]?.session_version).toBe(8);
    expect((await pool.query(`select 1 from audit_log where actor_user_id=$1 and action='superadmin.credential.rotated'`, [candidate.id])).rowCount).toBe(1);
  });

  it("recovers an unsanctioned account and invalidates old sessions once", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    await pool.query(`update users set status='restricted' where id=$1`, [candidate.id]);
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    expect((await pool.query(`select status,session_version from users where id=$1`, [candidate.id])).rows[0]).toMatchObject({ status: "active", session_version: 8 });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    expect((await pool.query(`select session_version from users where id=$1`, [candidate.id])).rows[0]?.session_version).toBe(8);
    expect((await pool.query(`select 1 from audit_log where actor_user_id=$1 and action='superadmin.account.recovered'`, [candidate.id])).rowCount).toBe(1);
  });

  it("replaces a revoked bootstrap grant immediately without invalidating browser sessions", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    await pool.query(
      `update permission_grants set revoked_at=now(),revoked_by=$1,revoke_reason='integration test'
        where user_id=$1 and permission=$2 and revoked_at is null`,
      [candidate.id, Permissions.ADMIN_PORTAL_ACCESS],
    );
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [candidate.id, Permissions.ADMIN_PORTAL_ACCESS])).rowCount).toBe(1);
    expect((await pool.query<{ session_version: number }>(`select session_version from users where id=$1`, [candidate.id])).rows[0]?.session_version).toBe(7);
  });

  it("replaces expired and missing catalog grants without invalidating browser sessions", async () => {
    const candidate = await existingCandidate({ withEvidence: true });
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    await pool.query(
      `update permission_grants
          set granted_at=now()-interval '2 minutes', expires_at=now()-interval '1 minute'
        where user_id=$1 and permission=$2 and revoked_at is null`,
      [candidate.id, Permissions.ADMIN_PORTAL_ACCESS],
    );
    await pool.query(
      `delete from permission_grants where user_id=$1 and permission=$2`,
      [candidate.id, Permissions.ADMIN_VIEW_PERMISSION_CATALOG],
    );
    await service({ username: candidate.username, password: "initial-superadmin-password" }).onApplicationBootstrap();
    expect((await pool.query(
      `select permission from permission_grants
        where user_id=$1 and permission=any($2::text[]) and revoked_at is null
          and (expires_at is null or expires_at>now())`,
      [candidate.id, [Permissions.ADMIN_PORTAL_ACCESS, Permissions.ADMIN_VIEW_PERMISSION_CATALOG]],
    )).rowCount).toBe(2);
    expect((await pool.query<{ session_version: number }>(`select session_version from users where id=$1`, [candidate.id])).rows[0]?.session_version).toBe(7);
  });
});
