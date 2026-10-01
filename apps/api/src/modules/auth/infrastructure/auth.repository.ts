import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import type { AuthSessionRegistryPort } from "../application/session.service.ts";
import type { AuthIdentityLookupPort, AuthIdentityLookupResult, AuthIdentityReadPort } from "../domain/identity-identifier.ts";
import { normalizeIdentityIdentifier } from "../domain/identity-identifier.ts";
import { identifierHash } from "./auth-crypto.ts";
import { hashPassword, verifyPassword } from "./password-hash.ts";
import { bindExistingSuperadminIdentity, recoverSuperadminAccount, resolveSuperadminIdentity, type ResolvedSuperadminIdentity } from "../../profile/public/legacy.ts";
import { SANCTIONS_READ_PORT, type SanctionsReadPort } from "../../sanctions/public/index.ts";

export interface PasswordCredentialUser {
  readonly id: UserIdType;
  readonly username: string;
  readonly passwordHash: string;
}

export interface PendingRegistrationInput {
  readonly emailHash: Buffer;
  readonly identityKey: string;
  readonly handle: string;
  readonly displayName: string;
  readonly gender: string | null;
  readonly birthYear: number | null;
  readonly passwordHash: string;
}

interface OtpRow {
  readonly id: string;
  readonly otp_hash: Buffer;
  readonly attempts: number;
  readonly expires_at: Date | string;
  readonly created_at: Date | string;
  readonly block_until: Date | string | null;
}

@Injectable()
export class AuthRepository implements AuthIdentityReadPort, AuthIdentityLookupPort, AuthSessionRegistryPort {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Optional() @Inject(SANCTIONS_READ_PORT) private readonly sanctions?: SanctionsReadPort,
  ) {}

  async findPasswordHashByUserId(userId: UserIdType): Promise<string | null> {
    const result = await this.pool.query<{ password_hash: string }>(
      `select password_hash from user_password_credentials where user_id=$1`,
      [userId],
    );
    return result.rows[0]?.password_hash ?? null;
  }

  async latestOtpCreatedAt(emailHash: Buffer): Promise<Date | null> {
    const result = await this.pool.query<{ created_at: Date | string }>(`select created_at from email_otp where email_hash = $1 order by created_at desc limit 1`, [emailHash]);
    const value = result.rows[0]?.created_at;
    return value === undefined ? null : new Date(value);
  }

  async createOtp(emailHash: Buffer, otpHash: Buffer, expiresAt: Date): Promise<void> {
    await this.pool.query(`insert into email_otp (email_hash, otp_hash, expires_at) values ($1, $2, $3)`, [emailHash, otpHash, expiresAt]);
  }

  async latestOtp(emailHash: Buffer): Promise<OtpRow | null> {
    const result = await this.pool.query<OtpRow>(`select id, otp_hash, attempts, expires_at, created_at, block_until from email_otp where email_hash = $1 order by created_at desc limit 1`, [emailHash]);
    return result.rows[0] ?? null;
  }

  async incrementOtpAttempts(id: string, blockUntil: Date | null): Promise<void> {
    await this.pool.query(`update email_otp set attempts = attempts + 1, block_until = coalesce($2, block_until) where id = $1`, [id, blockUntil]);
  }

  async consumeOtp(id: string): Promise<void> {
    await this.pool.query(`delete from email_otp where id = $1`, [id]);
  }

  async findIdentity(provider: "email_corp" | "plag_id", hash: Buffer): Promise<UserIdType | null> {
    const result = await this.pool.query<{ user_id: string }>(`select user_id from user_identities where provider = $1 and identifier_hash = $2`, [provider, hash]);
    const row = result.rows[0];
    return row === undefined ? null : UserId(row.user_id);
  }

  async createIdentity(userId: UserIdType, provider: "email_corp" | "plag_id", hash: Buffer, s3Key: string): Promise<void> {
    await this.pool.query(`insert into user_identities (user_id, provider, identifier_hash, s3_key) values ($1, $2, $3, $4)`, [userId, provider, hash, s3Key]);
  }

  async hasVerifiedIdentity(userId: UserIdType): Promise<boolean> {
    return (await this.pool.query(`select 1 from user_identities where user_id = $1 limit 1`, [userId])).rowCount !== 0;
  }

  async create(userId: UserIdType, expiresAt: Date): Promise<string> {
    const id = randomUUID();
    await this.pool.query(`insert into browser_sessions(id,user_id,expires_at) values($1,$2,$3)`, [id, userId, expiresAt]);
    return id;
  }
  async isActive(userId: UserIdType, sessionId: string): Promise<boolean> {
    const result = await this.pool.query(`update browser_sessions set last_seen_at=now() where id=$1 and user_id=$2 and revoked_at is null and expires_at>now() returning id`, [sessionId, userId]);
    return result.rowCount === 1;
  }
  async revoke(userId: UserIdType, sessionId: string, actorId: UserIdType, reason: string): Promise<boolean> {
    return (await this.pool.query(`update browser_sessions set revoked_at=now(),revoked_by=$3,revoke_reason=$4 where id=$1 and user_id=$2 and revoked_at is null`, [sessionId, userId, actorId, reason])).rowCount === 1;
  }
  async findBrowserSession(sessionId: string): Promise<{ readonly userId: UserIdType } | null> {
    const row = (await this.pool.query<{ user_id: string }>(`select user_id from browser_sessions where id=$1`, [sessionId])).rows[0];
    return row === undefined ? null : { userId: UserId(row.user_id) };
  }
  async revokeOtherSessions(userId: UserIdType, currentSessionId: string): Promise<void> {
    await this.pool.query(
      `update browser_sessions set revoked_at=now(),revoked_by=$1,revoke_reason='user_logout_other' where user_id=$1 and id<>$2 and revoked_at is null`,
      [userId, currentSessionId],
    );
  }
  async list(userId: UserIdType, limit: number) {
    const rows = (await this.pool.query<{ id: string; created_at: Date; expires_at: Date; last_seen_at: Date; revoked_at: Date | null }>(`select id,created_at,expires_at,last_seen_at,revoked_at from browser_sessions where user_id=$1 order by created_at desc,id desc limit $2`, [userId, limit])).rows;
    return rows.map((row) => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at }));
  }
  async revokeAllInTransaction(client: PoolClient, userId: UserIdType, actorId: UserIdType, reason: string): Promise<number> {
    return (await client.query(`update browser_sessions set revoked_at=now(),revoked_by=$2,revoke_reason=$3 where user_id=$1 and revoked_at is null`, [userId, actorId, reason])).rowCount ?? 0;
  }
  async listInTransaction(client: PoolClient, userId: UserIdType, limit: number) {
    const rows = (await client.query<{ id: string; created_at: Date; expires_at: Date; last_seen_at: Date; revoked_at: Date | null }>(
      `select id,created_at,expires_at,last_seen_at,revoked_at from browser_sessions where user_id=$1 order by created_at desc,id desc limit $2 for update`,
      [userId, limit],
    )).rows;
    return rows.map((row) => ({ id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at }));
  }
  async revokeInTransaction(client: PoolClient, userId: UserIdType, sessionId: string, actorId: UserIdType, reason: string): Promise<boolean> {
    return (await client.query(
      `update browser_sessions set revoked_at=now(),revoked_by=$3,revoke_reason=$4
        where id=$1 and user_id=$2 and revoked_at is null and expires_at>now()`,
      [sessionId, userId, actorId, reason],
    )).rowCount === 1;
  }
  async createPendingRegistration(input: PendingRegistrationInput): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(`select 1 from user_identities where provider = 'email_corp' and identifier_hash = $1`, [input.emailHash]);
      if ((existing.rowCount ?? 0) !== 0) {
        await client.query("rollback");
        return false;
      }
      let userId: string | undefined;
      for (let attempt = 0; attempt < 20 && userId === undefined; attempt += 1) {
        const username = attempt === 0 ? input.handle : `${input.handle.slice(0, 30)}${attempt + 1}`;
        const user = await client.query<{ id: string }>(
          `insert into users (username, display_name, gender, birth_year, status, handle_confirmed)
           values ($1, $2, $3, $4, 'restricted', false)
           on conflict (username) do nothing returning id`,
          [username, input.displayName, input.gender, input.birthYear],
        );
        userId = user.rows[0]?.id;
      }
      for (let attempt = 0; attempt < 10 && userId === undefined; attempt += 1) {
        const username = `${input.handle.slice(0, 25)}${randomBytes(3).toString("hex")}`;
        const user = await client.query<{ id: string }>(
          `insert into users (username, display_name, gender, birth_year, status, handle_confirmed)
           values ($1, $2, $3, $4, 'restricted', false)
           on conflict (username) do nothing returning id`,
          [username, input.displayName, input.gender, input.birthYear],
        );
        userId = user.rows[0]?.id;
      }
      if (userId === undefined) throw new Error("registration user insert failed");
      await client.query(`insert into user_identities (user_id, provider, identifier_hash, s3_key) values ($1, 'email_corp', $2, $3)`, [userId, input.emailHash, input.identityKey]);
      await client.query(`insert into auth_pending_registrations (user_id, password_hash) values ($1, $2)`, [userId, input.passwordHash]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async hasPendingRegistration(emailHash: Buffer): Promise<boolean> {
    const result = await this.pool.query(
      `select 1
       from user_identities identities
       join auth_pending_registrations pending on pending.user_id = identities.user_id
       where identities.provider = 'email_corp' and identities.identifier_hash = $1`,
      [emailHash],
    );
    return (result.rowCount ?? 0) !== 0;
  }

  async activatePendingRegistration(emailHash: Buffer): Promise<PasswordCredentialUser | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ id: string; username: string; password_hash: string }>(
        `select u.id, u.username, pending.password_hash
         from users u join user_identities identities on identities.user_id = u.id
         join auth_pending_registrations pending on pending.user_id = u.id
         where identities.provider = 'email_corp' and identities.identifier_hash = $1 for update`,
        [emailHash],
      );
      const row = result.rows[0];
      if (row === undefined) { await client.query("rollback"); return null; }
      await client.query(`update users set status = 'active', updated_at = now() where id = $1`, [row.id]);
      await client.query(`insert into user_password_credentials (user_id, password_hash) values ($1, $2)`, [row.id, row.password_hash]);
      await client.query(`delete from auth_pending_registrations where user_id = $1`, [row.id]);
      await client.query("commit");
      return { id: UserId(row.id), username: row.username, passwordHash: row.password_hash };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }

  async findUserByEmail(emailHash: Buffer): Promise<{ readonly id: UserIdType; readonly username: string } | null> {
    const result = await this.pool.query<{ id: string; username: string }>(`select u.id, u.username from users u join user_identities i on i.user_id = u.id where i.provider = 'email_corp' and i.identifier_hash = $1 and u.status = 'active'`, [emailHash]);
    const row = result.rows[0];
    return row === undefined ? null : { id: UserId(row.id), username: row.username };
  }

  async replacePassword(userId: UserIdType, passwordHash: string): Promise<void> {
    await this.pool.query(`insert into user_password_credentials (user_id, password_hash) values ($1, $2) on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`, [userId, passwordHash]);
  }


  async findPasswordCredential(username: string): Promise<PasswordCredentialUser | null> {
    const result = await this.pool.query<{ id: string; username: string; password_hash: string }>(
      `select u.id, u.username, credentials.password_hash
       from users u
       join user_password_credentials credentials on credentials.user_id = u.id
       where u.username = $1 and u.status = 'active'`,
      [username],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: UserId(row.id),
          username: row.username,
          passwordHash: row.password_hash,
        };
  }

  resolveSuperadminIdentityInTransaction(
    client: PoolClient,
    input: { readonly username: string; readonly externalStateEstablished: boolean },
  ): Promise<ResolvedSuperadminIdentity> {
    return resolveSuperadminIdentity(client, input);
  }

  bindExistingSuperadminIdentityInTransaction(client: PoolClient, userId: UserIdType): Promise<void> {
    return bindExistingSuperadminIdentity(client, userId);
  }

  async findUserByExactIdentity(input: {
    readonly provider: "email_corp" | "plag_id";
    readonly identifier: string;
  }): Promise<AuthIdentityLookupResult> {
    const normalized = normalizeIdentityIdentifier(input.provider, input.identifier);
    if (normalized === null) return { kind: "invalid" };
    const userId = await this.findIdentity(input.provider, identifierHash(normalized));
    return userId === null ? { kind: "not_found" } : { kind: "found", userId };
  }

  async hasAnyPasswordCredentialsInTransaction(client: PoolClient): Promise<boolean> {
    return (await client.query(`select 1 from user_password_credentials limit 1`)).rowCount !== 0;
  }

  async hasPasswordCredentialInTransaction(client: PoolClient, userId: UserIdType): Promise<boolean> {
    return (await client.query(`select 1 from user_password_credentials where user_id=$1 for update`, [userId])).rowCount !== 0;
  }

  async passwordMatchesInTransaction(client: PoolClient, userId: UserIdType, password: string): Promise<boolean> {
    const result = await client.query<{ password_hash: string }>(`select password_hash from user_password_credentials where user_id=$1 for update`, [userId]);
    const hash = result.rows[0]?.password_hash;
    return hash !== undefined && verifyPassword(password, hash);
  }

  async recoverSuperadminInTransaction(
    client: PoolClient,
    input: { readonly userId: UserIdType; readonly password: string },
  ): Promise<{ readonly passwordCreated: boolean; readonly passwordRotated: boolean; readonly accountRecovered: boolean; readonly sessionVersionChanged: boolean }> {
    const existingCredential = await client.query<{ password_hash: string }>(`select password_hash from user_password_credentials where user_id=$1 for update`, [input.userId]);
    const currentHash = existingCredential.rows[0]?.password_hash;
    const passwordCreated = currentHash === undefined;
    const passwordRotated = currentHash !== undefined && !(await verifyPassword(input.password, currentHash));
    const passwordHash = passwordCreated || passwordRotated ? await hashPassword(input.password) : null;
    if (passwordCreated) {
      await client.query(`insert into user_password_credentials(user_id,password_hash) values($1,$2)`, [input.userId, passwordHash]);
    } else if (passwordRotated) {
      await client.query(`update user_password_credentials set password_hash=$2,updated_at=now() where user_id=$1`, [input.userId, passwordHash]);
    }

    const activeSanction = this.sanctions ? await this.sanctions.findActiveForUserTx(client, input.userId) : null;
    const recovered = await recoverSuperadminAccount(client, {
      userId: input.userId,
      hasActiveSanction: activeSanction !== null,
      invalidateSessions: passwordRotated,
    });
    return {
      passwordCreated,
      passwordRotated,
      accountRecovered: recovered.recovered,
      sessionVersionChanged: recovered.sessionVersionChanged,
    };
  }
  async findPasswordCredentialByEmail(emailHash: Buffer): Promise<PasswordCredentialUser | null> {
    const result = await this.pool.query<{ id: string; username: string; password_hash: string }>(
      `select u.id, u.username, credentials.password_hash from users u
       join user_identities identities on identities.user_id = u.id
       join user_password_credentials credentials on credentials.user_id = u.id
       where identities.provider = 'email_corp' and identities.identifier_hash = $1 and u.status = 'active'`,
      [emailHash],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: UserId(row.id), username: row.username, passwordHash: row.password_hash };
  }

}
