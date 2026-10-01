import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { pool } from "../../../db/client.ts";
import { createNestApp } from "../../../nest/bootstrap.ts";
import { SessionVerifier } from "../../../nest/auth/session-verifier.ts";
import { UPLOAD_CONCURRENCY_PORT } from "../../projects/public/index.ts";
import { createFeedIngestApiKeyVerifier } from "../../publicapi/infrastructure/feed-ingest-api-key.ts";
import { FeedController } from "./feed.controller.ts";
import { AppModule } from "../../../nest/app.module.ts";
import { hashPassword } from "../../auth/infrastructure/password-hash.ts";
import { ADMIN_PRESET_V1 } from "../../permissions/domain/admin-assignment.ts";
import { Permissions } from "../../permissions/public/index.ts";
import { acquireSuperadminMarkerTestLease } from "../../../test/superadmin-marker-test-lease.ts";
import { FeedService } from "../application/feed.service.ts";
import { FeedRepository } from "../infrastructure/feed.repository.ts";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import {
  FEED_AGENT_AUTH_PORT, FEED_ANALYTICS_PORT, FEED_COMMUNITY_PORT, FEED_GITVERSE_PORT, FEED_INGEST_AUTH_PORT,
  FEED_MODEL_READ_PORT, FEED_PORT, FEED_RATE_LIMIT_PORT, FEED_REFERENCES_PORT, FEED_STORAGE_PORT, FEED_TAGS_READ_PORT, FEED_VOTES_PORT,
} from "../public/index.ts";

const fixturePath = new URL("../../../../../../packages/contracts/jobs/fixtures/feed-news.v1.json", import.meta.url);
const ids = { publisher: randomUUID(), outsider: randomUUID(), vendor: randomUUID(), community: randomUUID() };
const publisherKey = "mf_feedingest_pub-step7-publisher-secret";
const outsiderKey = "mf_feedingest_out-step7-outsider-secret";
const ingestVerifier = createFeedIngestApiKeyVerifier(pool, { loadOwnerAuthState: async () => ({ status: "active", sessionVersion: 1 }) } as never);

const communityPort = {
  findActive: async (id: string) => (await pool.query<{ id: string; kind: string }>(`select id,kind from communities where id=$1 and status='active'`, [id])).rows[0] ?? null,
  isMember: async () => false,
  subscribedCommunityIds: async () => [],
  canIngest: async (communityId: string, userId: string) => (await pool.query(`select 1 from community_members where community_id=$1 and user_id=$2 and role in ('owner','moderator')`, [communityId, userId])).rowCount === 1,
  resolveOfficialNewsCommunity: async (input: { subjectType: string; subjectId: string | null; subjectSlug: string | null }) => {
    const rows = (await pool.query<{ id: string; kind: string }>(
      `select id,kind from communities where status='active' and kind=$1 and subject_type=$1 and ($2::uuid is null or subject_id=$2) and ($3::text is null or lower(slug)=lower($3)) order by id limit 2`,
      [input.subjectType, input.subjectId, input.subjectSlug],
    )).rows;
    return rows.length === 1 ? rows[0] ?? null : null;
  },
  gateDenial: async () => null,
};

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
  controllers: [FeedController],
  providers: [
    { provide: DATABASE_POOL, useValue: pool }, FeedRepository, FeedService,
    { provide: FEED_PORT, useExisting: FeedService },
    { provide: SessionVerifier, useValue: { readSession: async () => null } },
    { provide: FEED_AGENT_AUTH_PORT, useValue: { verifyAgentContentToken: async () => null } },
    { provide: FEED_INGEST_AUTH_PORT, useValue: { verifyIngestToken: (token: string) => ingestVerifier.verify(token) } },
    { provide: FEED_COMMUNITY_PORT, useValue: communityPort },
    { provide: FEED_VOTES_PORT, useValue: {} }, { provide: FEED_TAGS_READ_PORT, useValue: {} }, { provide: FEED_MODEL_READ_PORT, useValue: {} },
    { provide: FEED_REFERENCES_PORT, useValue: { hydratePosts: async () => [], hydrateComments: async () => [] } },
    { provide: FEED_ANALYTICS_PORT, useValue: { emit: async () => undefined, hasActiveConsent: async () => false } },
    { provide: FEED_STORAGE_PORT, useValue: {} }, { provide: FEED_GITVERSE_PORT, useValue: {} },
    { provide: FEED_RATE_LIMIT_PORT, useValue: { assertAllowed: async () => undefined } },
    { provide: UPLOAD_CONCURRENCY_PORT, useValue: { acquire: () => undefined, release: () => undefined, getActive: () => 0 } },
  ],
})
class FeedNewsCutoverModule {}

describe.skipIf(!process.env.DATABASE_URL)("Step 7 Scout HTTP cutover", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let payload: Record<string, unknown>;
  let postId: string | undefined;

  beforeAll(async () => {
    await pool.query(`insert into users(id,username,status) values($1,$2,'active'),($3,$4,'active')`, [ids.publisher, `scout-${ids.publisher}`, ids.outsider, `ordinary-${ids.outsider}`]);
    await pool.query(`insert into vendors(id,slug,name) values($1,$2,$2)`, [ids.vendor, `step7-${ids.vendor}`]);
    await pool.query(`insert into communities(id,slug,name,kind,subject_type,subject_id,status) values($1,$2,$2,'vendor','vendor',$3,'active')`, [ids.community, `step7-${ids.community}`, ids.vendor]);
    await pool.query(`insert into community_members(community_id,user_id,role,source) values($1,$2,'owner','manual')`, [ids.community, ids.publisher]);
    const credentials: readonly (readonly [string, string])[] = [[ids.publisher, publisherKey], [ids.outsider, outsiderKey]];
    for (const [userId, key] of credentials) {
      await pool.query(`insert into user_api_keys(user_id,scope,scopes,label,key_prefix,key_hash) values($1,'feed_ingest',array['write'],'step7',$2,$3)`, [userId, key.slice(0, 20), createHash("sha256").update(key).digest()]);
    }
    const fixtures = JSON.parse(await readFile(fixturePath, "utf8")) as { rich_article: Record<string, unknown> };
    payload = structuredClone(fixtures.rich_article);
    for (const branch of [payload.candidate, payload.normalized_news]) {
      if (typeof branch !== "object" || branch === null || !("community_subject_hint" in branch)) throw new Error("fixture hint missing");
      const hint = branch.community_subject_hint;
      if (typeof hint !== "object" || hint === null) throw new Error("fixture hint missing");
      Object.assign(hint, { subject_type: "vendor", subject_id: ids.vendor, subject_slug: null });
    }
    app = await createNestApp(FeedNewsCutoverModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): { port: number } | null }).address();
    if (address === null) throw new Error("Step 7 server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (postId !== undefined) await pool.query(`delete from audit_log where target_id=$1`, [postId]);
    await pool.query(`delete from feed_posts where author_id=any($1::uuid[])`, [[ids.publisher, ids.outsider]]);
    await pool.query(`delete from user_api_keys where user_id=any($1::uuid[])`, [[ids.publisher, ids.outsider]]);
    await pool.query(`delete from community_members where community_id=$1`, [ids.community]);
    await pool.query(`delete from communities where id=$1`, [ids.community]);
    await pool.query(`delete from vendors where id=$1`, [ids.vendor]);
    await pool.query(`delete from users where id=any($1::uuid[])`, [[ids.publisher, ids.outsider]]);
  });

  const ingest = (key: string | null, body: unknown) => fetch(`${baseUrl}/feed/ingest`, {
    method: "POST", headers: { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }) }, body: JSON.stringify(body),
  });

  it("rejects browser/ordinary callers and machine callers without community ACL", async () => {
    expect((await ingest(null, payload)).status).toBe(401);
    expect((await ingest("mf_user_ordinary", payload)).status).toBe(401);
    expect((await ingest(outsiderKey, payload)).status).toBe(403);
  });

  it("creates a Scout draft, publishes it separately and replays both operations", async () => {
    const created = await ingest(publisherKey, payload);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { post: { id: string; status: string }; result: string };
    postId = createdBody.post.id;
    expect(createdBody).toMatchObject({ post: { status: "draft" }, result: "draft_created" });
    const replay = await ingest(publisherKey, payload);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ post: { id: postId }, result: "skipped", idempotent_replay: true });
    const published = await ingest(publisherKey, { action: "publish", post_id: postId });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({ post: { id: postId, status: "visible" }, result: "published", published_now: true });
    const republished = await ingest(publisherKey, { action: "publish", post_id: postId });
    expect(republished.status).toBe(200);
    expect(await republished.json()).toMatchObject({ result: "already_published", published_now: false });
    const row = await pool.query<{ editorial_origin: string; count: string }>(`select min(editorial_origin) editorial_origin,count(*)::text count from feed_posts where id=$1 group by source_fingerprint`, [postId]);
    expect(row.rows[0]).toEqual({ editorial_origin: "scout_pipeline", count: "1" });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("Step 7 News access after Admin removal", () => {
  const jwtSecret = "step7-news-access-http-secret";
  const password = "step7-news-access-password";
  const actorId = randomUUID();
  const targetId = randomUUID();
  const assignmentId = randomUUID();
  const sessionIds = { actor: randomUUID(), target: randomUUID() };
  let app: NestExpressApplication;
  let baseUrl: string;
  let releaseMarkerLease: () => Promise<void> = async () => undefined;

  async function token(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ username: `step7-${userId}`, sv: 1 }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setJti(sessionId).setExpirationTime("5m").sign(new TextEncoder().encode(jwtSecret));
  }

  beforeAll(async () => {
    releaseMarkerLease = await acquireSuperadminMarkerTestLease(pool);
    process.env.JWT_SECRET = jwtSecret;
    await pool.query(`insert into users(id,username,status) values($1,$2,'active'),($3,$4,'active')`, [actorId, `step7-actor-${actorId}`, targetId, `step7-target-${targetId}`]);
    await pool.query(`insert into user_password_credentials(user_id,password_hash) values($1,$2)`, [actorId, await hashPassword(password)]);
    await pool.query(`insert into browser_sessions(id,user_id,expires_at) values($1,$2,now()+interval '1 hour'),($3,$4,now()+interval '1 hour')`, [sessionIds.actor, actorId, sessionIds.target, targetId]);
    const actorPermissions = [Permissions.USER_REMOVE_ADMIN_ASSIGNMENT, Permissions.FEED_MANAGE_NEWS, Permissions.FEED_NEWS_EDITOR, ...ADMIN_PRESET_V1.permissions];
    for (const permission of new Set(actorPermissions)) await pool.query(`insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$1,'Step 7 actor fixture')`, [actorId, permission]);
    await pool.query(
      `insert into admin_permission_assignments(id,user_id,preset_key,preset_version,preset_snapshot,assigned_by,reason)
       values($1,$2,$3,$4,$5::jsonb,$6,'Step 7 existing Admin')`,
      [assignmentId, targetId, ADMIN_PRESET_V1.key, ADMIN_PRESET_V1.version, JSON.stringify(ADMIN_PRESET_V1.permissions), actorId],
    );
    for (const permission of ADMIN_PRESET_V1.permissions) {
      const grantId = (await pool.query<{ id: string }>(`insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'Admin preset fixture') returning id`, [targetId, permission, actorId])).rows[0]?.id;
      await pool.query(`insert into admin_permission_assignment_items(assignment_id,permission,coverage_kind,grant_id) values($1,$2,'assignment_grant',$3)`, [assignmentId, permission, grantId]);
    }
    await pool.query(`insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'pre-existing direct News grant')`, [targetId, Permissions.FEED_MANAGE_NEWS, actorId]);
    const companionId = (await pool.query<{ id: string }>(`insert into permission_grants(user_id,permission,granted_by,reason) values($1,$2,$3,'system companion fixture') returning id`, [targetId, Permissions.FEED_NEWS_EDITOR, actorId])).rows[0]?.id;
    await pool.query(`insert into admin_permission_assignment_items(assignment_id,permission,coverage_kind,grant_id) values($1,$2,'assignment_grant',$3)`, [assignmentId, Permissions.FEED_NEWS_EDITOR, companionId]);
    app = await createNestApp(AppModule);
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer() as { address(): { port: number } | null }).address();
    if (address === null) throw new Error("Step 7 access server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    await pool.query(`delete from audit_log where actor_user_id=any($1::uuid[]) or target_id=any($1::uuid[])`, [[actorId, targetId]]);
    await pool.query(`delete from permission_change_confirmations where actor_user_id=$1 or target_user_id=$2`, [actorId, targetId]);
    await pool.query(`delete from admin_permission_assignment_items where assignment_id=$1`, [assignmentId]);
    await pool.query(`delete from admin_permission_assignments where id=$1`, [assignmentId]);
    await pool.query(`delete from browser_sessions where user_id=any($1::uuid[])`, [[actorId, targetId]]);
    await pool.query(`delete from permission_grants where user_id=any($1::uuid[]) or granted_by=any($1::uuid[])`, [[actorId, targetId]]);
    await pool.query(`delete from user_password_credentials where user_id=$1`, [actorId]);
    await pool.query(`delete from users where id=any($1::uuid[])`, [[actorId, targetId]]);
    await releaseMarkerLease();
    delete process.env.JWT_SECRET;
  });

  it("keeps the direct grant but denies the next News request after HTTP removal", async () => {
    const targetAuthorization = `Bearer ${await token(targetId, sessionIds.target)}`;
    expect((await fetch(`${baseUrl}/data/news`, { headers: { authorization: targetAuthorization } })).status).toBe(200);
    expect((await pool.query(`select 1 from audit_log where actor_user_id=$1 and action='news.listed'`, [targetId])).rowCount).toBe(1);
    await pool.query(`update permission_grants set revoked_at=now(),revoked_by=$1,revoke_reason='Step 7 immediate revoke' where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.FEED_NEWS_EDITOR]);
    expect((await fetch(`${baseUrl}/data/news`, { headers: { authorization: targetAuthorization } })).status).toBe(403);
    await pool.query(`update permission_grants set revoked_at=null,revoked_by=null,revoke_reason=null where user_id=$1 and permission=$2`, [targetId, Permissions.FEED_NEWS_EDITOR]);
    await pool.query(`update permission_grants set granted_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where user_id=$1 and permission=$2`, [targetId, Permissions.FEED_MANAGE_NEWS]);
    expect((await fetch(`${baseUrl}/data/news`, { headers: { authorization: targetAuthorization } })).status).toBe(403);
    await pool.query(`update permission_grants set expires_at=null where user_id=$1 and permission=$2`, [targetId, Permissions.FEED_MANAGE_NEWS]);
    expect((await fetch(`${baseUrl}/data/news`, { headers: { authorization: targetAuthorization } })).status).toBe(200);
    const actorAuthorization = `Bearer ${await token(actorId, sessionIds.actor)}`;
    const preview = await fetch(`${baseUrl}/v1/admin/users/${targetId}/admin-assignment/remove/preview`, {
      method: "POST", headers: { authorization: actorAuthorization, "content-type": "application/json" }, body: JSON.stringify({ reason: "Step 7 remove Admin" }),
    });
    expect(preview.status).toBe(201);
    const intent = await preview.json() as { confirmation_id: string };
    const execute = await fetch(`${baseUrl}/v1/admin/users/${targetId}/admin-assignment/remove/execute`, {
      method: "POST", headers: { authorization: actorAuthorization, "content-type": "application/json" },
      body: JSON.stringify({ confirmation_id: intent.confirmation_id, reason: "Step 7 remove Admin", password }),
    });
    expect(execute.status).toBe(201);
    expect((await fetch(`${baseUrl}/data/news`, { headers: { authorization: targetAuthorization } })).status).toBe(403);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.FEED_MANAGE_NEWS])).rowCount).toBe(1);
    expect((await pool.query(`select 1 from permission_grants where user_id=$1 and permission=$2 and revoked_at is null`, [targetId, Permissions.FEED_NEWS_EDITOR])).rowCount).toBe(0);
  });
});
