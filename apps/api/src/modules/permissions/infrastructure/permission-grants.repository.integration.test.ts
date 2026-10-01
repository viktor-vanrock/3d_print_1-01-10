import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PermissionGrantAlreadyActiveError } from "../domain/permission-grant.ts";
import { Permissions } from "../domain/permissions.catalog.ts";
import { CURRENT_ADMIN_PRESET, RETIRED_ADMIN_V1_HEALTH_PERMISSION } from "../domain/admin-assignment.ts";
import { PermissionGrantsPgRepository } from "./permission-grants.repository.ts";
import { acquireSuperadminMarkerTestLease } from "../../../test/superadmin-marker-test-lease.ts";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("PermissionGrantsPgRepository bootstrap concurrency", () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const repository = new PermissionGrantsPgRepository(pool);
  const userId = UserId(randomUUID());
  const username = `permission-bootstrap-${userId}`;
  const reason = "bootstrap concurrency integration test";
  const createReason = "grant concurrency integration test";
  const input = { userId, permissions: [Permissions.CATALOG_EDIT_ANY], reason };

  beforeAll(async () => {
    await pool.query(`insert into users(id,username,status) values($1,$2,'active')`, [userId, username]);
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from audit_log where target_type='permission_grant'
           and target_id in (select id from permission_grants where user_id=$1 and reason=any($2::text[]))`,
        [userId, [reason, createReason]],
      );
      await client.query(`delete from permission_grants where user_id=$1 and reason=any($2::text[])`, [userId, [reason, createReason]]);
      await client.query(`delete from users where id=$1`, [userId]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("создаёт ровно один active global grant при конкурентном bootstrap", async () => {
    const outcomes = await Promise.all([repository.ensureBootstrapPermissions(input), repository.ensureBootstrapPermissions(input)]);

    expect(outcomes).toEqual(
      expect.arrayContaining([
        { created: 1, skipped: 0 },
        { created: 0, skipped: 1 },
      ]),
    );
    const grants = await pool.query<{ id: string }>(
      `select id from permission_grants where user_id=$1 and permission=$2 and scope='{"kind":"global"}'::jsonb
         and revoked_at is null and (expires_at is null or expires_at>now())`,
      [userId, Permissions.CATALOG_EDIT_ANY],
    );
    expect(grants.rows).toHaveLength(1);
    const audits = await pool.query(`select 1 from audit_log where action='permission.granted' and target_type='permission_grant' and target_id=$1`, [grants.rows[0]?.id]);
    expect(audits.rowCount).toBe(1);

    await expect(repository.ensureBootstrapPermissions(input)).resolves.toEqual({ created: 0, skipped: 1 });
  });

  it("сериализует конкурентную обычную выдачу одного permission", async () => {
    const create = () =>
      repository.createWithAudit({
        userId,
        permission: Permissions.RESEARCH_ACCESS,
        scope: { kind: "global" },
        grantedBy: userId,
        reason: createReason,
        expiresAt: null,
      });

    const outcomes = await Promise.allSettled([create(), create()]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(PermissionGrantAlreadyActiveError);

    const grants = await pool.query<{ id: string }>(
      `select id from permission_grants where user_id=$1 and permission=$2 and scope='{"kind":"global"}'::jsonb
         and revoked_at is null and (expires_at is null or expires_at>now())`,
      [userId, Permissions.RESEARCH_ACCESS],
    );
    expect(grants.rows).toHaveLength(1);
    const audits = await pool.query(
      `select 1 from audit_log
       where action='permission.granted' and target_type='permission_grant' and target_id=$1`,
      [grants.rows[0]?.id],
    );
    expect(audits.rowCount).toBe(1);
  });
});

describe.skipIf(!DATABASE_URL)("PermissionGrantsPgRepository confirmed Admin changes", () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const repository = new PermissionGrantsPgRepository(pool);
  const actorId = UserId(randomUUID());
  const targetId = UserId(randomUUID());
  const fingerprint = "a".repeat(64);
  let releaseMarkerLease: () => Promise<void> = () => Promise.resolve();

  beforeAll(async () => {
    releaseMarkerLease = await acquireSuperadminMarkerTestLease(pool);
    await pool.query(
      `insert into users(id,username,status,session_version) values($1,$2,'active',3),($3,$4,'active',1)`,
      [actorId, `step4-actor-${actorId}`, targetId, `step4-target-${targetId}`],
    );
    const actorPermissions = [
      Permissions.USER_ASSIGN_ADMIN, Permissions.USER_REMOVE_ADMIN_ASSIGNMENT, Permissions.USER_REVOKE_ALL_ADMIN_ACCESS,
      Permissions.USER_GRANT_PERMISSION, Permissions.USER_REVOKE_PERMISSION, Permissions.RESEARCH_ACCESS,
      Permissions.AUDIT_VIEW_LOG,
      Permissions.CATALOG_FEATURE,
      Permissions.FEED_MANAGE_NEWS,
      Permissions.FEED_NEWS_EDITOR,
      ...CURRENT_ADMIN_PRESET.permissions,
    ];
    for (const permission of new Set(actorPermissions)) {
      await pool.query(
        `insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$1,'Step 4 actor fixture')`,
        [actorId, permission],
      );
    }
    await pool.query(
      `insert into permission_grants(user_id,permission,granted_by,reason) values
       ($1,$2,$3,'pre-existing direct grant'),($1,$4,$3,'ordinary researcher access'),
       ($1,$5,$3,'ordinary printer research management')`,
      [targetId, Permissions.USER_VIEW_ANY, actorId, Permissions.RESEARCH_ACCESS, Permissions.RESEARCH_MANAGE_PRINTERS],
    );
  });

  afterAll(async () => {
    try {
      const users = [actorId, targetId];
      await pool.query(`delete from audit_log where actor_user_id=any($1::uuid[]) or target_id=any($1::uuid[])`, [users]);
      await pool.query(`delete from permission_change_confirmations where actor_user_id=any($1::uuid[]) or target_user_id=any($1::uuid[])`, [users]);
      await pool.query(`delete from admin_permission_assignment_items where assignment_id in (select id from admin_permission_assignments where user_id=any($1::uuid[]))`, [users]);
      await pool.query(`delete from admin_permission_assignments where user_id=any($1::uuid[])`, [users]);
      await pool.query(`delete from permission_grants where user_id=any($1::uuid[]) or granted_by=any($1::uuid[])`, [users]);
      await pool.query(`delete from users where id=any($1::uuid[])`, [users]);
    } finally {
      await releaseMarkerLease();
      await pool.end();
    }
  });

  it("materializes the current preset, preserves direct overlap on removal and rejects replay", async () => {
    const assign = {
      actorId, targetId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_ASSIGN_ADMIN,
      payload: { action: "assign_admin" as const, reason: "approved Admin assignment" },
    };
    const intent = await repository.preparePermissionChange(assign);
    expect(intent.effects.added.map((item) => item.permission).sort()).toEqual([
      Permissions.ADMIN_PORTAL_ACCESS,
      Permissions.ADMIN_VIEW_PERMISSION_CATALOG,
    ].sort());
    expect(intent.effects.retained.map((item) => item.permission)).toEqual(expect.arrayContaining([
      Permissions.USER_VIEW_ANY,
      Permissions.RESEARCH_ACCESS,
      Permissions.RESEARCH_MANAGE_PRINTERS,
    ]));
    const assigned = await repository.executePermissionChange({ ...assign, confirmationId: intent.id });
    expect(assigned.createdGrantIds).toHaveLength(2);
    await expect(repository.executePermissionChange({ ...assign, confirmationId: intent.id })).rejects.toThrow(/already used|уже использовано/i);

    const items = await pool.query<{ permission: string; coverage_kind: string }>(
      `select permission,coverage_kind from admin_permission_assignment_items order by permission`,
    );
    expect(items.rows).toContainEqual({ permission: Permissions.USER_VIEW_ANY, coverage_kind: "direct_existing" });
    const access = await repository.readUserAccessState({ actorId, targetId });
    expect(access.assignment).toMatchObject({
      presetKey: "admin.default",
      presetVersion: 2,
      presetSnapshot: CURRENT_ADMIN_PRESET.permissions,
      missingSnapshotPermissions: [],
    });
    expect(access.assignment?.presetSnapshot).not.toContain(RETIRED_ADMIN_V1_HEALTH_PERMISSION);
    expect(access.grants.find((grant) => grant.permission === Permissions.USER_VIEW_ANY)?.provenance).toBe("direct");
    expect(access.grants.find((grant) => grant.permission === Permissions.ADMIN_PORTAL_ACCESS)?.provenance).toBe("admin_assignment");

    const remove = {
      actorId, targetId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_REMOVE_ADMIN_ASSIGNMENT,
      payload: { action: "remove_admin_assignment" as const, reason: "remove preset only" },
    };
    const removeIntent = await repository.preparePermissionChange(remove);
    expect(removeIntent.effects.revoked).toHaveLength(2);
    expect(removeIntent.effects.retained.map((item) => item.permission)).toEqual(expect.arrayContaining([
      Permissions.USER_VIEW_ANY,
      Permissions.RESEARCH_ACCESS,
      Permissions.RESEARCH_MANAGE_PRINTERS,
    ]));
    const removed = await repository.executePermissionChange({ ...remove, confirmationId: removeIntent.id });
    expect(removed.revokedGrantIds).toHaveLength(2);
    expect(removed.remainingDirectPermissions).toContain(Permissions.USER_VIEW_ANY);
    expect(removed.remainingDirectPermissions).not.toContain(Permissions.RESEARCH_ACCESS);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.USER_VIEW_ANY])).rowCount).toBe(1);

    const reassignIntent = await repository.preparePermissionChange(assign);
    await repository.executePermissionChange({ ...assign, confirmationId: reassignIntent.id });
    const newsGrant = {
      actorId, targetId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_GRANT_PERMISSION,
      payload: { action: "grant_permission" as const, reason: "editorial duty", permission: Permissions.FEED_MANAGE_NEWS, expires_at: null },
    };
    const newsIntent = await repository.preparePermissionChange(newsGrant);
    expect(newsIntent.effects.added.map((item) => item.permission)).toEqual([Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR]);
    await repository.executePermissionChange({ ...newsGrant, confirmationId: newsIntent.id });
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.FEED_MANAGE_NEWS])).rowCount).toBe(1);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.FEED_NEWS_EDITOR])).rowCount).toBe(1);

    const removeNewsIntent = await repository.preparePermissionChange(remove);
    expect(removeNewsIntent.effects.retained.map((item) => item.permission)).toContain(Permissions.FEED_MANAGE_NEWS);
    expect(removeNewsIntent.effects.retained.map((item) => item.permission)).toContain(Permissions.FEED_NEWS_EDITOR);
    await repository.executePermissionChange({ ...remove, confirmationId: removeNewsIntent.id });
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.FEED_MANAGE_NEWS])).rowCount).toBe(1);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.FEED_NEWS_EDITOR])).rowCount).toBe(1);
  });

  it("rechecks session, permission and payload and consumes one intent only once under a race", async () => {
    const grant = {
      actorId, targetId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_GRANT_PERMISSION,
      payload: { action: "grant_permission" as const, reason: "temporary portal access", permission: Permissions.ADMIN_PORTAL_ACCESS, expires_at: null },
    };
    const intent = await repository.preparePermissionChange(grant);
    await expect(repository.executePermissionChange({ ...grant, sessionVersion: 2, confirmationId: intent.id })).rejects.toThrow();
    await expect(repository.executePermissionChange({ ...grant, payload: { ...grant.payload, reason: "changed" }, confirmationId: intent.id })).rejects.toThrow();
    const outcomes = await Promise.allSettled([
      repository.executePermissionChange({ ...grant, confirmationId: intent.id }),
      repository.executePermissionChange({ ...grant, confirmationId: intent.id }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const stale = {
      ...grant,
      payload: { ...grant.payload, permission: Permissions.CATALOG_FEATURE },
    };
    const staleIntent = await repository.preparePermissionChange(stale);
    await pool.query(
      `insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'state changed after preview')`,
      [targetId, Permissions.AUDIT_VIEW_LOG, actorId],
    );
    await expect(repository.executePermissionChange({ ...stale, confirmationId: staleIntent.id })).rejects.toThrow(/устарел/);

    const secondPayload = { ...grant.payload, permission: Permissions.CATALOG_FEATURE };
    const secondIntent = await repository.preparePermissionChange({ ...grant, payload: secondPayload });
    await pool.query(
      `update permission_grants set revoked_at=now(),revoked_by=$1,revoke_reason='fixture revoke between preview and execute'
       where user_id=$1 and permission=$2 and revoked_at is null`,
      [actorId, Permissions.USER_GRANT_PERMISSION],
    );
    await expect(repository.executePermissionChange({ ...grant, payload: secondPayload, confirmationId: secondIntent.id })).rejects.toThrow();
  });

  it("revoke-all preserves ordinary research access", async () => {
    await pool.query(
      `insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'direct admin fixture')
       on conflict do nothing`,
      [targetId, Permissions.ADMIN_PORTAL_ACCESS, actorId],
    );
    const change = {
      actorId, targetId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_REVOKE_ALL_ADMIN_ACCESS,
      payload: { action: "revoke_all_admin_access" as const, reason: "full administrative lockout" },
    };
    const intent = await repository.preparePermissionChange(change);
    await repository.executePermissionChange({ ...change, confirmationId: intent.id });
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.ADMIN_PORTAL_ACCESS])).rowCount).toBe(0);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.RESEARCH_ACCESS])).rowCount).toBe(1);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.RESEARCH_MANAGE_PRINTERS])).rowCount).toBe(1);
  });

  it("keeps reason and confirmation payload out of audit metadata", async () => {
    const sensitiveReason = "private operational reason 4815162342";
    const change = {
      actorId, targetId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_ASSIGN_ADMIN,
      payload: { action: "assign_admin" as const, reason: sensitiveReason },
    };
    await repository.preparePermissionChange(change);
    const audit = await pool.query<{ details: unknown }>(
      `select details from audit_log where actor_user_id=$1 and action like 'admin.permission_change.%'`, [actorId],
    );
    const serialized = JSON.stringify(audit.rows);
    expect(serialized).not.toContain(sensitiveReason);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("password");
  });

  it("blocks self-elevation, expired intents and the marked Superadmin target", async () => {
    const selfChange = {
      actorId, targetId: actorId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_ASSIGN_ADMIN,
      payload: { action: "assign_admin" as const, reason: "self elevation attempt" },
    };
    await expect(repository.preparePermissionChange(selfChange)).rejects.toThrow(/собственные/);

    const expiring = {
      actorId, targetId, sessionFingerprint: fingerprint, sessionVersion: 3,
      requiredPermission: Permissions.USER_ASSIGN_ADMIN,
      payload: { action: "assign_admin" as const, reason: "expired intent fixture" },
    };
    const intent = await repository.preparePermissionChange(expiring);
    await pool.query(
      `update permission_change_confirmations set created_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes' where id=$1`,
      [intent.id],
    );
    await expect(repository.executePermissionChange({ ...expiring, confirmationId: intent.id })).rejects.toThrow(/недействительно/);

    const protectedId = UserId(randomUUID());
    await pool.query(`insert into users(id,username,status,session_version) values($1,$2,'active',1)`, [protectedId, `protected-${protectedId}`]);
    await pool.query(
      `insert into platform_superadmin_identity(identity_key,user_id,binding_mode,bound_at) values('superadmin',$1,'new_installation',now())`,
      [protectedId],
    );
    try {
      await expect(repository.preparePermissionChange({ ...expiring, targetId: protectedId })).rejects.toThrow(/startup provisioning/);
    } finally {
      await pool.query(`delete from platform_superadmin_identity where user_id=$1`, [protectedId]);
      await pool.query(`delete from users where id=$1`, [protectedId]);
    }
  });
});
