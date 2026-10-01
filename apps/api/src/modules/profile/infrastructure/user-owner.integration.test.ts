import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db/client.ts";
import { bindExistingSuperadminIdentity, recoverSuperadminAccount, resolveSuperadminIdentity } from "./user-owner.ts";
import { acquireSuperadminMarkerTestLease } from "../../../test/superadmin-marker-test-lease.ts";

const users: string[] = [];
let releaseMarkerLease: () => Promise<void> = () => Promise.resolve();
beforeAll(async () => { releaseMarkerLease = await acquireSuperadminMarkerTestLease(pool); });

async function createUser(status: "active" | "restricted"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into users(username, status, handle_confirmed, session_version)
     values ($1, $2, false, 7) returning id`,
    [`bootstrap-owner-${randomUUID()}`, status],
  );
  const id = result.rows[0]!.id;
  users.push(id);
  return id;
}

afterAll(async () => {
  try {
    if (users.length > 0) await pool.query(`delete from platform_superadmin_identity where user_id = any($1::uuid[])`, [users]);
    if (users.length > 0) await pool.query(`delete from users where id = any($1::uuid[])`, [users]);
  } finally { await releaseMarkerLease(); }
});

describe("stable Superadmin identity", () => {
  it("keeps a sanctioned bootstrap account restricted without changing its session version", async () => {
    const id = await createUser("restricted");
    const client = await pool.connect();
    try {
      await recoverSuperadminAccount(client, { userId: id, hasActiveSanction: true, invalidateSessions: false });
    } finally {
      client.release();
    }
    await expect(pool.query(`select status, handle_confirmed, session_version from users where id = $1`, [id])).resolves.toMatchObject({
      rows: [{ status: "restricted", handle_confirmed: true, session_version: 7 }],
    });
  });

  it("activates an unsanctioned bootstrap account and invalidates prior sessions", async () => {
    const id = await createUser("restricted");
    const client = await pool.connect();
    try {
      await recoverSuperadminAccount(client, { userId: id, hasActiveSanction: false, invalidateSessions: false });
    } finally {
      client.release();
    }
    await expect(pool.query(`select status, handle_confirmed, session_version from users where id = $1`, [id])).resolves.toMatchObject({
      rows: [{ status: "active", handle_confirmed: true, session_version: 8 }],
    });
  });

  it("keeps a healthy no-op restart byte-stable for session state", async () => {
    const id = await createUser("active");
    await pool.query(`update users set handle_confirmed=true where id=$1`, [id]);
    const client = await pool.connect();
    try {
      await expect(recoverSuperadminAccount(client, { userId: id, hasActiveSanction: false, invalidateSessions: false })).resolves.toEqual({
        recovered: false,
        sessionVersionChanged: false,
      });
    } finally {
      client.release();
    }
    await expect(pool.query(`select session_version from users where id=$1`, [id])).resolves.toMatchObject({ rows: [{ session_version: 7 }] });
  });

  it("invalidates sessions for explicit password rotation without changing identity", async () => {
    const id = await createUser("active");
    const client = await pool.connect();
    try {
      await recoverSuperadminAccount(client, { userId: id, hasActiveSanction: false, invalidateSessions: true });
    } finally {
      client.release();
    }
    await expect(pool.query(`select session_version from users where id=$1`, [id])).resolves.toMatchObject({ rows: [{ session_version: 8 }] });
  });

  it("selects an unbound legacy candidate once and never reselects by username after binding", async () => {
    const id = await createUser("active");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const username = (await client.query<{ username: string }>(`select username from users where id=$1`, [id])).rows[0]!.username;
      await expect(resolveSuperadminIdentity(client, { username, externalStateEstablished: true })).resolves.toMatchObject({ id, bindingMode: "existing_installation", bindingCreated: false });
      await bindExistingSuperadminIdentity(client, id);
      await client.query(`update users set username=$2 where id=$1`, [id, `renamed-${randomUUID()}`]);
      await expect(resolveSuperadminIdentity(client, { username: "stale-config-name", externalStateEstablished: true })).resolves.toMatchObject({ id, bindingCreated: false });
      await expect(resolveSuperadminIdentity(client, { username: "other", externalStateEstablished: true })).resolves.toMatchObject({ id, bindingCreated: false });
      await client.query("commit");
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});
