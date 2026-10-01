import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { hashPassword } from "../infrastructure/password-hash.ts";
import { AuthStepUpService } from "./auth-step-up.service.ts";

describe("AuthStepUpService", () => {
  it("accepts only the current actor password and fails closed without a credential", async () => {
    const actorId = UserId("00000000-0000-4000-8000-000000000001");
    const repository = { findPasswordHashByUserId: vi.fn().mockResolvedValue(await hashPassword("correct password")) };
    const service = new AuthStepUpService(repository);
    await expect(service.verifyPassword(actorId, "correct password")).resolves.toBe(true);
    await expect(service.verifyPassword(actorId, "wrong password")).resolves.toBe(false);
    repository.findPasswordHashByUserId.mockResolvedValueOnce(null);
    await expect(service.verifyPassword(actorId, "correct password")).resolves.toBe(false);
  });
});
