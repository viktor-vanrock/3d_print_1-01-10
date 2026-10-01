import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { SanctionAlreadyActiveError, SanctionIdempotencyConflictError, SanctionNotActiveError, SanctionTargetIsBootstrapAdminError } from "../domain/sanction.errors.ts";
import { DevicesRepository } from "../../devices/infrastructure/devices.repository.ts";
import { ProfileRepository } from "../../profile/infrastructure/profile.repository.ts";
import { ProjectsOutboxRepository } from "../../projects/infrastructure/outbox.repository.ts";
import { PublicApiRepository } from "../../publicapi/infrastructure/publicapi.repository.ts";
import { SanctionsRepository } from "../infrastructure/sanctions.repository.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import { SanctionsService } from "./sanctions.service.ts";
import { PermissionGrantsPgRepository } from "../../permissions/infrastructure/permission-grants.repository.ts";
import { PermissionsService } from "../../permissions/application/permissions.service.ts";
import { SanctionsAuthorizationService } from "./sanctions-authorization.service.ts";
import { acquireSuperadminMarkerTestLease } from "../../../test/superadmin-marker-test-lease.ts";

const users: string[] = [];
const sanctions: string[] = [];
let releaseMarkerLease: () => Promise<void> = () => Promise.resolve();
beforeAll(async () => { releaseMarkerLease = await acquireSuperadminMarkerTestLease(pool); });
function service(): SanctionsService {
  const profiles = new ProfileRepository(pool);
  const authorization = new SanctionsAuthorizationService(new PermissionsService(new PermissionGrantsPgRepository(pool)));
  return new SanctionsService(
    pool, new SanctionsRepository(pool), profiles,
    new DevicesRepository(pool, {} as never), new PublicApiRepository(pool, profiles), new ProjectsOutboxRepository(pool), authorization,
  );
}
async function user(input: { staff?: boolean; status?: "active" | "restricted" | "deleted"; username?: string } = {}): Promise<ReturnType<typeof UserId>> {
  const row = await pool.query<{ id: string }>(
    `insert into users(username, status) values($1,$2) returning id`,
    [input.username ?? `sanctions-service-${randomUUID()}`, input.status ?? "active"],
  );
  if (input.staff) await pool.query(`insert into permission_grants(user_id, permission, granted_by, reason) values($1, 'moderation.manage_sanctions', $1, 'test fixture')`, [row.rows[0]!.id]);
  users.push(row.rows[0]!.id);
  return UserId(row.rows[0]!.id);
}
const command = (actorId: ReturnType<typeof UserId>, targetId: ReturnType<typeof UserId>, idempotencyKey = randomUUID()) => ({
  actorId, targetId, type: "ban" as const, reasonCode: "fraud" as const, reasonNote: "fixture", evidenceUrl: null, endsAt: null, idempotencyKey,
});

afterAll(async () => {
  try {
    await pool.query(`delete from platform_superadmin_identity where user_id = any($1::uuid[])`, [users]);
    if (sanctions.length > 0) await pool.query(`delete from outbox_events where aggregate_type='Sanction' and aggregate_id = any($1::uuid[])`, [sanctions]);
    if (sanctions.length > 0) await pool.query(`delete from sanctions where id = any($1::uuid[])`, [sanctions]);
    if (users.length > 0) await pool.query(`delete from permission_grants where user_id = any($1::uuid[]) or granted_by = any($1::uuid[])`, [users]);
    if (users.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [users]);
  } finally { await releaseMarkerLease(); }
});

describe("SanctionsService", () => {
  it("protects the marker-bound Superadmin even after username changes", async () => {
    const actor = await user({ staff: true }); const target = await user({ username: `superadmin-before-${randomUUID()}` });
    await pool.query(`insert into platform_superadmin_identity(identity_key,user_id,binding_mode) values('superadmin',$1,'existing_installation')`, [target]);
    await pool.query(`update users set username=$2 where id=$1`, [target, `superadmin-after-${randomUUID()}`]);
    await expect(service().create(command(actor, target))).rejects.toBeInstanceOf(SanctionTargetIsBootstrapAdminError);
    await pool.query(`delete from platform_superadmin_identity where user_id=$1`, [target]);
  });
  it("creates an atomic cascade without changing PII, and matching retries do not cascade again", async () => {
    const actor = await user({ staff: true }); const target = await user(); const key = randomUUID();
    await pool.query(`update users set display_name='PII fixture', bio='private' where id=$1`, [target]);
    const first = await service().create(command(actor, target, key)); sanctions.push(first.sanction.id);
    expect(first).toMatchObject({ reused: false, sanction: { state: "active" }, cascade: { sessionVersion: 2 } });
    await expect(pool.query(`select status, session_version, display_name, bio from users where id=$1`, [target])).resolves.toMatchObject({ rows: [{ status: "restricted", session_version: 2, display_name: "PII fixture", bio: "private" }] });
    await expect(pool.query(`select event_type from outbox_events where aggregate_id=$1`, [first.sanction.id])).resolves.toMatchObject({ rows: [{ event_type: "sanction.relay_close.v1" }] });
    await expect(service().create(command(actor, target, key))).resolves.toMatchObject({ reused: true, cascade: null, sanction: { id: first.sanction.id } });
    await expect(pool.query(`select session_version from users where id=$1`, [target])).resolves.toMatchObject({ rows: [{ session_version: 2 }] });
  });

  it("rejects conflicting idempotency payloads and a second active sanction", async () => {
    const actor = await user({ staff: true }); const target = await user(); const key = randomUUID(); const created = await service().create(command(actor, target, key)); sanctions.push(created.sanction.id);
    await expect(service().create({ ...command(actor, target, key), reasonCode: "abuse" })).rejects.toBeInstanceOf(SanctionIdempotencyConflictError);
    await expect(service().create(command(actor, target))).rejects.toBeInstanceOf(SanctionAlreadyActiveError);
  });

  it("cancels without restoring credentials or bumping the session version", async () => {
    const actor = await user({ staff: true }); const target = await user(); const created = await service().create(command(actor, target)); sanctions.push(created.sanction.id);
    await expect(service().cancel({ actorId: actor, sanctionId: created.sanction.id, cancelReason: "reviewed" })).resolves.toMatchObject({ state: "cancelled", cancelReason: "reviewed" });
    await expect(pool.query(`select status, session_version from users where id=$1`, [target])).resolves.toMatchObject({ rows: [{ status: "active", session_version: 2 }] });
    await expect(service().cancel({ actorId: actor, sanctionId: created.sanction.id, cancelReason: "again" })).rejects.toBeInstanceOf(SanctionNotActiveError);
  });
});
