import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AdminAuditReadService } from "./admin-audit-read.service.ts";
import { Permissions } from "../../permissions/public/index.ts";

const actorId = UserId("00000000-0000-4000-8000-000000000001");
const row = {
  id: "00000000-0000-4000-8000-000000000002",
  actorUserId: actorId,
  action: "admin.user.viewed",
  targetType: "user",
  targetId: "00000000-0000-4000-8000-000000000003",
  details: { outcome: "success", status: "active", count: 3, permission: Permissions.USER_VIEW_ANY, secret: "hidden" },
  createdAt: new Date("2026-09-20T00:00:00.000Z"),
};

function repository() {
  return {
    read: vi.fn().mockResolvedValue([row]),
    recordAuditBrowse: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AdminAuditReadService", () => {
  it("uses one bounded default range and emits only validated metadata", async () => {
    const repo = repository();
    const service = new AdminAuditReadService(repo, () => new Date("2026-09-25T12:00:00.000Z"));
    const result = await service.events(actorId, {});
    expect(repo.read).toHaveBeenCalledWith(expect.objectContaining({
      filter: expect.objectContaining({ from: "2026-08-25T12:00:00.000Z", to: "2026-09-25T12:00:00.000Z" }),
    }));
    expect(result.items[0]?.metadata).toEqual({ outcome: "success", status: "active", count: 3, permission: Permissions.USER_VIEW_ANY });
    expect(result.items[0]?.details_masked).toBe(true);
    expect(repo.recordAuditBrowse).toHaveBeenCalledOnce();
  });

  it("rejects invalid and wider-than-31-day ranges", async () => {
    const service = new AdminAuditReadService(repository(), () => new Date("2026-09-25T12:00:00.000Z"));
    await expect(service.events(actorId, { from: "2026-01-01T00:00:00Z", to: "2026-09-01T00:00:00Z" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.events(actorId, { from: "invalid" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("omits metadata for unknown actions and unsafe values in allowlisted fields", async () => {
    const repo = repository();
    repo.read.mockResolvedValue([
      { ...row, action: "unknown.action", details: { outcome: "success" } },
      { ...row, id: "00000000-0000-4000-8000-000000000004", details: { outcome: "password=leak", count: 1_000_001, permission: "not.catalogued" } },
    ]);
    const result = await new AdminAuditReadService(repo, () => new Date("2026-09-25T12:00:00.000Z")).events(actorId, {});
    expect(result.items[0]?.metadata).toEqual({});
    expect(result.items[1]?.metadata).toEqual({});
  });

  it("fails the read when its mandatory audit write fails", async () => {
    const repo = repository();
    repo.recordAuditBrowse.mockRejectedValue(new Error("audit unavailable"));
    await expect(new AdminAuditReadService(repo, () => new Date("2026-09-25T12:00:00.000Z")).events(actorId, {})).rejects.toThrow("audit unavailable");
  });
});
