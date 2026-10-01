import { describe, expect, it, vi } from "vitest";
import { FeedPostId, UserId } from "../../_kernel/brandedIds.ts";
import type { FeedPostRecord } from "../domain/feed.ts";
import { FeedAdminService } from "./feed-admin.service.ts";

const actorId = UserId("00000000-0000-0000-0000-000000000001");
const postId = FeedPostId("00000000-0000-0000-0000-000000000002");

function record(status: string, origin: FeedPostRecord["editorial_origin"] = "manual_admin"): FeedPostRecord {
  return {
    id: postId, author_id: actorId, co_author_agent_id: null, community_id: null, type: "text", title: "Новость",
    body: "Текст", model_id: null, media_s3_key: null, make_id: null, poster_s3_key: null, gitverse_url: null,
    gitverse_meta: null, votes_up: 0, votes_down: 0, comments_count: 0, status, created_at: new Date("2026-09-14T12:00:00Z"),
    is_edited: false, edited_at: null, editorial_origin: origin,
    source_url: origin === "manual_admin" ? null : "https://vendor.example/news", source_fingerprint: origin === "manual_admin" ? null : "fingerprint",
    ingest_provider: origin === "manual_admin" ? null : origin === "forge_import" ? "forge-snapshot" : "local",
    ingest_model: origin === "manual_admin" ? null : "model", ingest_prompt_version: origin === "manual_admin" ? null : "v2",
  };
}

function repository(overrides: Partial<ConstructorParameters<typeof FeedAdminService>[0]> = {}): ConstructorParameters<typeof FeedAdminService>[0] {
  return {
    listAdmin: vi.fn(async () => []),
    find: vi.fn(async () => null),
    createAdmin: vi.fn(async () => record("draft")),
    updateAdmin: vi.fn(async () => null),
    transitionAdminStatus: vi.fn(async () => null),
    recordNewsAccess: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("FeedAdminService", () => {
  it("создаёт ручную новость только как draft", async () => {
    const repo = repository({ createAdmin: vi.fn(async () => record("draft")) });
    const service = new FeedAdminService(repo);
    const result = await service.create(actorId, { title: " Новость ", body: "Текст" });
    expect(repo.createAdmin).toHaveBeenCalledWith(actorId, expect.objectContaining({ title: "Новость" }));
    expect(result.item.status).toBe("draft");
    expect(result.item.source).toBe("manual");
  });

  it("публикует draft идемпотентно", async () => {
    const repo = repository({
      transitionAdminStatus: vi.fn(async () => record("visible")),
    });
    const service = new FeedAdminService(repo);
    await expect(service.publish(actorId, postId)).resolves.toMatchObject({ item: { status: "published" } });
    expect(repo.transitionAdminStatus).toHaveBeenCalledWith(actorId, postId, "visible", ["draft", "visible", "hidden"]);
  });

  it("повторно публикует скрытую новость", async () => {
    const repo = repository({
      transitionAdminStatus: vi.fn(async () => record("visible")),
    });
    const service = new FeedAdminService(repo);
    await expect(service.publish(actorId, postId)).resolves.toMatchObject({ item: { status: "published" } });
    expect(repo.transitionAdminStatus).toHaveBeenCalledWith(actorId, postId, "visible", ["draft", "visible", "hidden"]);
  });

  it("различает Scout, Forge и ручные записи в списке", async () => {
    const repo = repository({ listAdmin: vi.fn(async () => [record("draft", "scout_pipeline"), record("visible", "forge_import"), record("visible")]) });
    const service = new FeedAdminService(repo);
    const result = await service.list(actorId, { status: "all", source: "all" });
    expect(result.items.map((item) => item.source)).toEqual(["scout", "forge", "manual"]);
    expect(repo.recordNewsAccess).toHaveBeenCalledWith(actorId, "news.listed", actorId);
  });

  it("не возвращает editorial read, если audit не записался", async () => {
    const repo = repository({ listAdmin: vi.fn(async () => [record("draft")]), recordNewsAccess: vi.fn(async () => { throw new Error("audit failed"); }) });
    const service = new FeedAdminService(repo);
    await expect(service.list(actorId, {})).rejects.toThrow("audit failed");
  });

  it("передаёт явный null для очистки community", async () => {
    const repo = repository({ updateAdmin: vi.fn(async () => record("draft")) });
    const service = new FeedAdminService(repo);
    await service.update(actorId, postId, { community_id: null });
    expect(repo.updateAdmin).toHaveBeenCalledWith(actorId, postId, { title: undefined, body: undefined, communityId: null });
  });
});
