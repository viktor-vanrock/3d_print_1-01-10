import { randomUUID } from "node:crypto";
import type { Provider } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { UserId, type UserId as UserIdType } from "../modules/_kernel/brandedIds.ts";
import { AUTH_SESSION_REGISTRY_PORT, type AuthSessionRegistryPort } from "../modules/auth/public/index.ts";
import { PROFILE_AUTH_PORT, type NewUserSeed, type ProfileAuthPort, type SessionProfile } from "../modules/profile/public/index.ts";

type AccountState = Awaited<ReturnType<ProfileAuthPort["loadOwnerAuthState"]>>;

/** Fail-closed, per-test authorization fixture for modules that exercise the real SessionVerifier. */
export class SessionVerifierTestFixture implements ProfileAuthPort, AuthSessionRegistryPort {
  private readonly accounts = new Map<UserIdType, NonNullable<AccountState>>();
  private readonly sessions = new Set<string>();

  registerAccount(userId: string, state: NonNullable<AccountState> = {
    status: "active",
    administrativeState: "active",
    sessionVersion: 1,
  }): void {
    this.accounts.set(UserId(userId), state);
  }

  registerSession(userId: string, sessionId: string): void {
    this.sessions.add(this.sessionKey(UserId(userId), sessionId));
  }

  clear(): void {
    this.accounts.clear();
    this.sessions.clear();
  }

  loadOwnerAuthState(userId: UserIdType): Promise<AccountState> {
    return Promise.resolve(this.accounts.get(userId) ?? null);
  }

  findSessionUser(): Promise<SessionProfile | null> { return Promise.resolve(null); }
  bumpSessionVersion(): Promise<boolean> { return Promise.resolve(false); }
  createUserWithFreeHandle(_seed: NewUserSeed): Promise<UserIdType> { return Promise.reject(new Error("not supported by session fixture")); }
  upsertDevUser(): Promise<SessionProfile | null> { return Promise.resolve(null); }

  create(): Promise<string> { return Promise.resolve(randomUUID()); }
  isActive(userId: UserIdType, sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.has(this.sessionKey(userId, sessionId)));
  }
  revoke(): Promise<boolean> { return Promise.resolve(false); }
  list(): Promise<readonly never[]> { return Promise.resolve([]); }
  revokeAllInTransaction(_client: PoolClient): Promise<number> { return Promise.resolve(0); }
  listInTransaction(_client: PoolClient): Promise<readonly never[]> { return Promise.resolve([]); }
  revokeInTransaction(_client: PoolClient): Promise<boolean> { return Promise.resolve(false); }

  private sessionKey(userId: UserIdType, sessionId: string): string {
    return `${userId}:${sessionId}`;
  }
}

export const SESSION_VERIFIER_TEST_REGISTRY_PROVIDERS: readonly Provider[] = [
  SessionVerifierTestFixture,
  { provide: AUTH_SESSION_REGISTRY_PORT, useExisting: SessionVerifierTestFixture },
];

export const SESSION_VERIFIER_TEST_AUTH_PROVIDERS: readonly Provider[] = [
  ...SESSION_VERIFIER_TEST_REGISTRY_PROVIDERS,
  { provide: PROFILE_AUTH_PORT, useExisting: SessionVerifierTestFixture },
];

/** Registers one explicit active browser session; unknown ids remain denied by the real repository. */
export async function registerTestBrowserSession(pool: Pool, userId: string): Promise<{ readonly id: string; readonly expiresAt: Date }> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await pool.query(`insert into browser_sessions(id,user_id,expires_at) values($1,$2,$3)`, [id, userId, expiresAt]);
  return { id, expiresAt };
}
