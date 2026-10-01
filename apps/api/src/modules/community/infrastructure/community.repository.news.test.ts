import { describe, expect, it, vi } from "vitest";
import { CommunityRepository } from "./community.repository.ts";

describe("CommunityRepository News target resolution", () => {
  it("requires one exact active catalog-backed community", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "community", kind: "vendor" }] });
    const repository = new CommunityRepository({ query } as never);
    await expect(repository.resolveOfficialNewsCommunity({ subjectType: "vendor", subjectId: "00000000-0000-4000-8000-000000000001", subjectSlug: null })).resolves.toEqual({ id: "community", kind: "vendor" });
    expect(String(query.mock.calls[0]?.[0])).toContain("status='active'");
    expect(String(query.mock.calls[0]?.[0])).toContain("kind=$1 and subject_type=$1");
  });

  it("fails closed for an ambiguous or malformed hint", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "one", kind: "vendor" }, { id: "two", kind: "vendor" }] });
    const repository = new CommunityRepository({ query } as never);
    await expect(repository.resolveOfficialNewsCommunity({ subjectType: "vendor", subjectId: null, subjectSlug: "same" })).resolves.toBeNull();
    await expect(repository.resolveOfficialNewsCommunity({ subjectType: "vendor", subjectId: null, subjectSlug: null })).resolves.toBeNull();
  });
});
