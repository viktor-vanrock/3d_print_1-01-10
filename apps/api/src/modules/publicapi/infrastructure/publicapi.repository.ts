import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import type { PublicApiKeyScope, PublicApiSanctionsPort } from "../public/index.ts";

export interface ApiKeyRow {
  readonly id: string;
  readonly name: string;
  readonly key_prefix: string;
  readonly scopes: PublicApiKeyScope[];
  readonly revoked_at: Date | null;
  readonly last_used_at: Date | null;
  readonly created_at: Date;
  readonly expires_at?: Date | null;
}
export interface UserApiKeyRow {
  readonly id: string;
  readonly label: string | null;
  readonly key_prefix: string;
  readonly scope: string;
  readonly status: string;
  readonly last_used_at: Date | null;
  readonly created_at: Date;
  readonly revoked_at: Date | null;
}
export type ApiKeyVerification =
  | { readonly kind: "active"; readonly row: { id: string; owner_id: string; scopes: PublicApiKeyScope[] } }
  | { readonly kind: "revoked" | "unknown" | "user_blocked" };

@Injectable()
export class PublicApiRepository implements PublicApiSanctionsPort {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
  ) {}

  async activeApiKeyCount(ownerId: UserId): Promise<number> {
    const r = await this.pool.query<{ count: string }>(
      `select count(*) as count from api_keys where owner_id=$1 and revoked_at is null and (expires_at is null or expires_at>now())`,
      [ownerId],
    );
    return Number(r.rows[0]?.count ?? "0");
  }
  async insertApiKey(ownerId: UserId, input: { name: string; prefix: string; hash: Buffer; scopes: readonly PublicApiKeyScope[] }): Promise<ApiKeyRow> {
    const r = await this.pool.query<ApiKeyRow>(
      `insert into api_keys(owner_id,name,key_prefix,key_hash,scopes) values($1,$2,$3,$4,$5) returning id,name,key_prefix,scopes,revoked_at,last_used_at,created_at`,
      [ownerId, input.name, input.prefix, input.hash, input.scopes],
    );
    return r.rows[0]!;
  }
  async listApiKeys(ownerId: UserId): Promise<readonly ApiKeyRow[]> {
    return (
      await this.pool.query<ApiKeyRow>(`select id,name,key_prefix,scopes,revoked_at,last_used_at,created_at from api_keys where owner_id=$1 order by created_at desc`, [ownerId])
    ).rows;
  }
  async revokeApiKey(ownerId: UserId, id: string): Promise<boolean> {
    return (await this.pool.query(`update api_keys set revoked_at=now() where id=$1 and owner_id=$2 and revoked_at is null`, [id, ownerId])).rowCount !== 0;
  }
  async hasApiKey(ownerId: UserId, id: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from api_keys where id=$1 and owner_id=$2`, [id, ownerId])).rowCount !== 0;
  }
  async rotateApiKey(ownerId: UserId, id: string, input: { name?: string; prefix: string; hash: Buffer }): Promise<ApiKeyRow | "not_found" | "already_revoked"> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      const existing = await c.query<{ name: string; revoked_at: Date | null }>(`select name,revoked_at from api_keys where id=$1 and owner_id=$2 for update`, [id, ownerId]);
      const old = existing.rows[0];
      if (!old) {
        await c.query("rollback");
        return "not_found";
      }
      if (old.revoked_at) {
        await c.query("rollback");
        return "already_revoked";
      }
      const name = input.name?.trim().slice(0, 128) || old.name;
      const inserted = await c.query<ApiKeyRow>(
        `insert into api_keys(owner_id,name,key_prefix,key_hash,scopes) select owner_id,$3,$4,$5,scopes from api_keys where id=$1 and owner_id=$2 returning id,name,key_prefix,scopes,revoked_at,last_used_at,created_at`,
        [id, ownerId, name, input.prefix, input.hash],
      );
      await c.query(`update api_keys set revoked_at=now() where id=$1`, [id]);
      await c.query("commit");
      return inserted.rows[0]!;
    } catch (error) {
      await c.query("rollback").catch(() => {});
      throw error;
    } finally {
      c.release();
    }
  }
  async verifyApiKey(hash: Buffer): Promise<ApiKeyVerification> {
    const r = await this.pool.query<{ id: string; owner_id: string; scopes: PublicApiKeyScope[]; revoked_at: Date | null; expires_at: Date | null; status: string; key_kind: "api_key" | "user_api_key" }>(
      `select id,owner_id,scopes,revoked_at,expires_at,
              case when revoked_at is null then 'active' else 'revoked' end as status,
              'api_key'::text as key_kind
         from api_keys where key_hash=$1
       union all
       select id,user_id as owner_id,scopes,revoked_at,expires_at,status,
              'user_api_key'::text as key_kind
         from user_api_keys where key_hash=$1 and scope='public_api'
       limit 1`,
      [hash],
    );
    const row = r.rows[0];
    if (row === undefined) return { kind: "revoked" };
    if (row.status !== "active" || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= new Date())) return { kind: "revoked" };
    const owner = await this.profiles.loadOwnerAuthState(row.owner_id as UserId);
    if (owner === null) return { kind: "unknown" };
    if (owner.status !== "active") return { kind: "user_blocked" };
    const lastUsed = row.key_kind === "api_key"
      ? this.pool.query(`update api_keys set last_used_at=now() where id=$1`, [row.id])
      : this.pool.query(`update user_api_keys set last_used_at=now() where id=$1`, [row.id]);
    void lastUsed.catch(() => {});
    return { kind: "active", row };
  }

  async insertUserApiKey(input: {
    ownerId: UserId;
    agentId?: string;
    scope: string;
    scopes?: readonly string[];
    label: string;
    prefix: string;
    hash: Buffer;
  }): Promise<UserApiKeyRow> {
    const r = await this.pool.query<UserApiKeyRow>(
      `insert into user_api_keys(user_id,agent_id,scope,scopes,label,key_prefix,key_hash) values($1,$2,$3,$4,$5,$6,$7) returning id,label,key_prefix,scope,status,last_used_at,created_at,revoked_at`,
      [input.ownerId, input.agentId ?? null, input.scope, input.scopes ?? ["read"], input.label, input.prefix, input.hash],
    );
    return r.rows[0]!;
  }
  async listUserApiKeys(ownerId: UserId, scope: string, limit: number, offset: number): Promise<readonly UserApiKeyRow[]> {
    return (
      await this.pool.query<UserApiKeyRow>(
        `select id,label,key_prefix,scope,status,last_used_at,created_at,revoked_at from user_api_keys where user_id=$1 and scope=$2 order by created_at desc,id desc limit $3 offset $4`,
        [ownerId, scope, limit, offset],
      )
    ).rows;
  }
  async revokeUserApiKey(ownerId: UserId, id: string, scope: string): Promise<boolean> {
    return (
      (await this.pool.query(`update user_api_keys set status='revoked',revoked_at=now() where id=$1 and user_id=$2 and scope=$3 and status='active'`, [id, ownerId, scope]))
        .rowCount !== 0
    );
  }
  async hasUserApiKey(ownerId: UserId, id: string, scope: string): Promise<boolean> {
    return (await this.pool.query(`select 1 from user_api_keys where id=$1 and user_id=$2 and scope=$3`, [id, ownerId, scope])).rowCount !== 0;
  }
  async listAgentKeys(ownerId: UserId, agentId: string): Promise<readonly UserApiKeyRow[]> {
    return (
      await this.pool.query<UserApiKeyRow>(
        `select id,label,key_prefix,scope,status,last_used_at,created_at,revoked_at from user_api_keys where user_id=$1 and agent_id=$2 and scope='agent_content' order by created_at desc`,
        [ownerId, agentId],
      )
    ).rows;
  }
  async revokeAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean> {
    return (
      (
        await this.pool.query(
          `update user_api_keys set status='revoked',revoked_at=now() where id=$1 and user_id=$2 and agent_id=$3 and scope='agent_content' and status='active'`,
          [keyId, ownerId, agentId],
        )
      ).rowCount !== 0
    );
  }
  async hasAgentKey(ownerId: UserId, agentId: string, keyId: string): Promise<boolean> {
    return (
      await this.pool.query(`select 1 from user_api_keys where id=$1 and user_id=$2 and agent_id=$3 and scope='agent_content'`, [keyId, ownerId, agentId])
    ).rowCount !== 0;
  }
  async revokeAllAgentKeys(agentId: string): Promise<number> {
    const result = await this.pool.query(`update user_api_keys set status='revoked',revoked_at=now(),revoked_reason='agent_revoked' where agent_id=$1 and status='active'`, [agentId]);
    return result.rowCount ?? 0;
  }

  async revokeCredentialsForSanction(tx: PoolClient, input: { readonly ownerId: UserId }): Promise<{ readonly apiKeysRevoked: number; readonly userApiKeysRevoked: number }> {
    const apiKeys = await tx.query(`update api_keys set revoked_at = now() where owner_id = $1 and revoked_at is null`, [input.ownerId]);
    const userApiKeys = await tx.query(
      `update user_api_keys set status = 'revoked', revoked_at = now(), revoked_reason = 'owner_sanctioned', updated_at = now()
       where user_id = $1 and status = 'active'`,
      [input.ownerId],
    );
    return { apiKeysRevoked: apiKeys.rowCount ?? 0, userApiKeysRevoked: userApiKeys.rowCount ?? 0 };
  }

  async listForAdmin(userId: UserId, limit: number) {
    const rows = (await this.pool.query<{ id: string; kind: "api_key" | "user_api_key"; label: string; prefix: string; status: "active" | "revoked"; created_at: Date; last_used_at: Date | null }>(
      `select id::text,'api_key'::text as kind,name as label,key_prefix as prefix,case when revoked_at is null then 'active' else 'revoked' end as status,created_at,last_used_at from api_keys where owner_id=$1
       union all select id::text,'user_api_key',coalesce(label,'API key'),key_prefix,status,created_at,last_used_at from user_api_keys where user_id=$1 and scope in ('public_api','research')
       order by created_at desc,id desc limit $2`, [userId, limit],
    )).rows;
    return rows.map((row) => ({ id: row.id, kind: row.kind, label: row.label, prefix: row.prefix, status: row.status, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
  }
  async listInTransaction(tx: PoolClient, userId: UserId, limit: number) {
    const publicRows = (await tx.query<{ id: string; kind: "api_key"; label: string; prefix: string; status: "active" | "revoked"; created_at: Date; last_used_at: Date | null }>(
      `select id::text,'api_key'::text as kind,name as label,key_prefix as prefix,
              case when revoked_at is null then 'active' else 'revoked' end as status,created_at,last_used_at
         from api_keys where owner_id=$1 order by created_at desc,id desc limit $2 for update`, [userId, limit],
    )).rows;
    const userRows = (await tx.query<{ id: string; kind: "user_api_key"; label: string; prefix: string; status: "active" | "revoked"; created_at: Date; last_used_at: Date | null }>(
      `select id::text,'user_api_key'::text as kind,coalesce(label,'API key') as label,key_prefix as prefix,status,created_at,last_used_at
         from user_api_keys where user_id=$1 and scope in ('public_api','research') order by created_at desc,id desc limit $2 for update`, [userId, limit],
    )).rows;
    const rows = [...publicRows, ...userRows].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id)).slice(0, limit);
    return rows.map((row) => ({ id: row.id, kind: row.kind, label: row.label, prefix: row.prefix, status: row.status, createdAt: row.created_at, lastUsedAt: row.last_used_at }));
  }
  async revokeAllInTransaction(tx: PoolClient, userId: UserId): Promise<number> {
    const a = await tx.query(`update api_keys set revoked_at=now() where owner_id=$1 and revoked_at is null`, [userId]);
    const b = await tx.query(`update user_api_keys set status='revoked',revoked_at=now(),revoked_reason='admin_account_state' where user_id=$1 and status='active'`, [userId]);
    return (a.rowCount ?? 0) + (b.rowCount ?? 0);
  }
  async revokeInTransaction(tx: PoolClient, input: { readonly userId: UserId; readonly keyId: string }): Promise<boolean> {
    if ((await tx.query(`update api_keys set revoked_at=now() where id=$1 and owner_id=$2 and revoked_at is null`, [input.keyId, input.userId])).rowCount === 1) return true;
    return (await tx.query(`update user_api_keys set status='revoked',revoked_at=now(),revoked_reason='admin_action' where id=$1 and user_id=$2 and status='active' and scope in ('public_api','research')`, [input.keyId, input.userId])).rowCount === 1;
  }
  async rotateApiKeyInTransaction(tx: PoolClient, input: { readonly userId: UserId; readonly keyId: string; readonly prefix: string; readonly hash: Buffer }): Promise<boolean> {
    return (await tx.query(`update api_keys set key_prefix=$3,key_hash=$4,revoked_at=null,created_at=now(),last_used_at=null where id=$1 and owner_id=$2 and revoked_at is null`, [input.keyId, input.userId, input.prefix, input.hash])).rowCount === 1;
  }
  async lockAdminKey(tx: PoolClient, input: { readonly userId: UserId; readonly keyId: string }): Promise<{ readonly kind: "api_key" | "user_api_key"; readonly scope: string } | null> {
    const publicKey = (await tx.query<{ readonly present: number }>(`select 1 as present from api_keys where id=$1 and owner_id=$2 and revoked_at is null for update`, [input.keyId, input.userId])).rows[0];
    if (publicKey !== undefined) return { kind: "api_key", scope: "public_api" };
    const userKey = (await tx.query<{ scope: string }>(`select scope from user_api_keys where id=$1 and user_id=$2 and status='active' and scope in ('public_api','research') for update`, [input.keyId, input.userId])).rows[0];
    return userKey === undefined ? null : { kind: "user_api_key", scope: userKey.scope };
  }
  async rotateUserApiKeyInTransaction(tx: PoolClient, input: { readonly userId: UserId; readonly keyId: string; readonly prefix: string; readonly hash: Buffer }): Promise<boolean> {
    return (await tx.query(
      `update user_api_keys set key_prefix=$3,key_hash=$4,updated_at=now(),last_used_at=null
        where id=$1 and user_id=$2 and status='active' and scope in ('public_api','research')`,
      [input.keyId, input.userId, input.prefix, input.hash],
    )).rowCount === 1;
  }
}
