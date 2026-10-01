import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../../db/client.ts";

export interface OwnedUserSummary {
  readonly id: string;
  readonly username: string;
}

export interface ResolvedSuperadminIdentity {
  readonly id: string;
  readonly username: string;
  readonly accountCreated: boolean;
  readonly bindingCreated: boolean;
  readonly bindingMode: "new_installation" | "existing_installation" | null;
}

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

export async function resolveSuperadminIdentity(
  client: PoolClient,
  input: { readonly username: string; readonly externalStateEstablished: boolean },
): Promise<ResolvedSuperadminIdentity> {
  const bound = await client.query<{ user_id: string; username: string }>(
    `select identity.user_id, users.username
       from platform_superadmin_identity identity
       join users on users.id = identity.user_id
      where identity.identity_key = 'superadmin'
      for update of identity, users`,
  );
  const existingBinding = bound.rows[0];
  if (existingBinding !== undefined) {
    return { id: existingBinding.user_id, username: existingBinding.username, accountCreated: false, bindingCreated: false, bindingMode: null };
  }

  const state = await client.query<{ established: boolean }>(
    `select exists(select 1 from users where id <> $1) as established`,
    [SYSTEM_USER_ID],
  );
  const established = state.rows[0]?.established === true || input.externalStateEstablished;
  if (established) {
    const candidate = await client.query<{ id: string; username: string; status: string }>(
      `select id,username,status from users where username=$1 for update`,
      [input.username],
    );
    const row = candidate.rows[0];
    if (row === undefined || row.status === "deleted") throw new Error("Configured Superadmin identity cannot be verified for existing installation");
    return { id: row.id, username: row.username, accountCreated: false, bindingCreated: false, bindingMode: "existing_installation" };
  }

  const userId = randomUUID();
  const created = await client.query<{ id: string; username: string }>(
    `insert into users(id,username,display_name,status,handle_confirmed)
     values($1,$2,$2,'active',true)
     returning id,username`,
    [userId, input.username],
  );
  const row = created.rows[0];
  if (row === undefined) throw new Error("Failed to create Superadmin account");
  await client.query(
    `insert into platform_superadmin_identity(identity_key,user_id,binding_mode)
     values('superadmin',$1,'new_installation')`,
    [row.id],
  );
  return { id: row.id, username: row.username, accountCreated: true, bindingCreated: true, bindingMode: "new_installation" };
}

export async function bindExistingSuperadminIdentity(client: PoolClient, userId: string): Promise<void> {
  if (userId === SYSTEM_USER_ID) throw new Error("System actor cannot become Superadmin");
  await client.query(
    `insert into platform_superadmin_identity(identity_key,user_id,binding_mode)
     values('superadmin',$1,'existing_installation')`,
    [userId],
  );
}

export async function recoverSuperadminAccount(
  client: PoolClient,
  input: { readonly userId: string; readonly hasActiveSanction: boolean; readonly invalidateSessions: boolean },
): Promise<{ readonly recovered: boolean; readonly sessionVersionChanged: boolean }> {
  const current = await client.query<{ status: string; handle_confirmed: boolean }>(`select status,handle_confirmed from users where id=$1 for update`, [input.userId]);
  const before = current.rows[0];
  if (before === undefined) throw new Error("Bound Superadmin account does not exist");
  const recovered = !input.hasActiveSanction && before.status !== "active";
  const sessionVersionChanged = input.invalidateSessions || recovered;
  if (!recovered && before.handle_confirmed && !input.invalidateSessions) return { recovered: false, sessionVersionChanged: false };

  const result = await client.query(
    `update users
     set handle_confirmed = true,
         status = case when $2 then status else 'active' end,
         session_version = case when $3 then session_version + 1 else session_version end,
         updated_at = now()
     where id = $1`,
    [input.userId, input.hasActiveSanction, sessionVersionChanged],
  );
  if ((result.rowCount ?? 0) === 0) throw new Error("Bound Superadmin account does not exist");
  return { recovered, sessionVersionChanged };
}

export interface OwnedMasterRow<TProfile = unknown> {
  readonly id: string;
  readonly is_master: boolean;
  readonly master_profile: TProfile;
}

export async function upsertDevUser(): Promise<OwnedUserSummary | null> {
  const result = await pool.query<{ id: string; username: string; status: string }>(
    `insert into users (username, display_name, handle_confirmed)
     values ('devuser', 'DEV Reviewer', true)
     on conflict (username) do update set display_name = excluded.display_name, updated_at = now()
     returning id, username, status`,
  );
  const row = result.rows[0];
  return row !== undefined && row.status === "active" ? { id: row.id, username: row.username } : null;
}

export async function becomeMaster<TProfile = unknown>(userId: string): Promise<OwnedMasterRow<TProfile> | null> {
  const result = await pool.query<OwnedMasterRow<TProfile>>(
    `update users set is_master = true, updated_at = now() where id = $1
     returning id, is_master, master_profile`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function updateOwnedMasterProfile<TProfile extends object>(userId: string, masterProfile: TProfile): Promise<OwnedMasterRow<TProfile> | null> {
  const result = await pool.query<OwnedMasterRow<TProfile>>(
    `update users set master_profile = $2, updated_at = now() where id = $1
     returning id, is_master, master_profile`,
    [userId, JSON.stringify(masterProfile)],
  );
  return result.rows[0] ?? null;
}

export async function lockOwnedUser(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query(`select id from users where id = $1 for update`, [userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function incrementOwnedReputation(client: PoolClient, userId: string, delta: number): Promise<void> {
  await client.query(`update users set reputation_score = reputation_score + $2 where id = $1`, [userId, delta]);
}

export async function setOwnedTrustLevel(userId: string, level: number): Promise<void> {
  await pool.query(`update users set trust_level = $2 where id = $1`, [userId, level]);
}

export interface OwnedContentAuthor {
  readonly id: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

export async function findOwnedContentAuthors(userIds: readonly string[]): Promise<ReadonlyMap<string, OwnedContentAuthor>> {
  if (userIds.length === 0) return new Map();
  const rows = (
    await pool.query<{ id: string; username: string; display_name: string | null; avatar_url: string | null }>(
      `select user_id as id, username, display_name, avatar_url from identity_read_v1 where user_id = any($1::uuid[])`,
      [userIds],
    )
  ).rows;
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      },
    ]),
  );
}

export async function getOwnedTrustState(userId: string): Promise<{
  readonly reputation_score: number;
  readonly trust_level: number;
  readonly trust_level_manual: boolean;
} | null> {
  const result = await pool.query<{
    reputation_score: number;
    trust_level: number;
    trust_level_manual: boolean;
  }>(`select reputation_score, trust_level, trust_level_manual from users where id = $1`, [userId]);
  return result.rows[0] ?? null;
}

export async function markOwnedActivationHasPrinter(client: PoolClient, userId: string, hasPrinter: boolean): Promise<void> {
  await client.query(`update user_activation set has_printer = $2, updated_at = now() where user_id = $1`, [userId, hasPrinter]);
}
