import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { CommunityRepository } from "../infrastructure/community.repository.ts";
import { CommunityService } from "./community.service.ts";
import type {
  CommunityAnalyticsPort,
  CommunityCatalogPort,
  CommunityFeedPort,
  CommunityModelsPort,
  CommunityProfilePort,
  CommunityReputationPort,
  CommunityStoragePort,
} from "./community.ports.ts";
const stub = <T>(value: unknown) => value as T;
describe("CommunityService owner boundary", () => {
  it("relies on the exact controller permission and keeps domain validation", async () => {
    const bootstrap = vi.fn().mockResolvedValue("owner");
    const service = new CommunityService(
      stub<CommunityRepository>({ bootstrap }),
      stub<CommunityFeedPort>({}),
      stub<CommunityCatalogPort>({}),
      stub<CommunityModelsPort>({}),
      stub<CommunityProfilePort>({ exists: vi.fn().mockResolvedValue(true) }),
      stub<CommunityAnalyticsPort>({}),
      stub<CommunityReputationPort>({}),
      stub<CommunityStoragePort>({}),
    );
    const actor = UserId("11111111-1111-4111-8111-111111111111");
    const target = UserId("22222222-2222-4222-8222-222222222222");
    await expect(service.bootstrapOwner("33333333-3333-4333-8333-333333333333", target, actor)).resolves.toEqual({ role: "owner", user_id: target });
  });
  it("owns polymorphic vote mutation for other social domains", async () => {
    const socialVote = vi.fn().mockResolvedValue({ up: 3, down: 1, isNew: true });
    const service = new CommunityService(
      stub<CommunityRepository>({ socialVote }),
      stub<CommunityFeedPort>({}),
      stub<CommunityCatalogPort>({}),
      stub<CommunityModelsPort>({}),
      stub<CommunityProfilePort>({}),
      stub<CommunityAnalyticsPort>({}),
      stub<CommunityReputationPort>({}),
      stub<CommunityStoragePort>({}),
    );
    await expect(service.applyVote("feed_post", "11111111-1111-4111-8111-111111111111", UserId("22222222-2222-4222-8222-222222222222"), 1)).resolves.toEqual({
      votesUp: 3,
      votesDown: 1,
      isNewCast: true,
      castValue: 1,
    });
    expect(socialVote).toHaveBeenCalledOnce();
  });
});
