import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AdminOperationsService } from "./admin-operations.service.ts";

const actorId = UserId("11111111-1111-4111-8111-111111111111");
const targetId = UserId("22222222-2222-4222-8222-222222222222");
const actor = { actorId, sessionFingerprint: "a".repeat(64), sessionVersion: 2 };

function setup() {
  const tx = {};
  const confirmations = {
    prepareAdministrativeConfirmation: vi.fn().mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333", expiresAt: new Date("2030-01-01") }),
    executeAdministrativeConfirmation: vi.fn(async (input) => input.mutate(tx)),
  };
  const stepUp = { verifyPassword: vi.fn().mockResolvedValue(true) };
  const profiles = {
    readState: vi.fn().mockResolvedValue({ status: "active", administrativeState: "active", sessionVersion: 1 }),
    lockState: vi.fn().mockResolvedValue({ status: "active", administrativeState: "active", sessionVersion: 1 }),
    isProtectedSuperadmin: vi.fn().mockResolvedValue(false), setAdministrativeState: vi.fn(), closeAccount: vi.fn(),
  };
  const directory = { findAdminDirectoryUser: vi.fn().mockResolvedValue({ id: targetId, username: "target", displayName: null, status: "active", createdAt: new Date(0), updatedAt: new Date(0) }) };
  const sessions = { list: vi.fn().mockResolvedValue([]), listInTransaction: vi.fn().mockResolvedValue([]), revokeAllInTransaction: vi.fn().mockResolvedValue(2), revokeInTransaction: vi.fn().mockResolvedValue(true) };
  const keys = { listForAdmin: vi.fn().mockResolvedValue([]), listInTransaction: vi.fn().mockResolvedValue([]), revokeAllInTransaction: vi.fn().mockResolvedValue(3), revokeInTransaction: vi.fn().mockResolvedValue(true), rotateInTransaction: vi.fn().mockResolvedValue({ id: "key", prefix: "mf_pub_x", secret: "one-time" }) };
  const audit = { audit: vi.fn() };
  const readsAudit = { record: vi.fn() };
  return { confirmations, stepUp, profiles, sessions, keys, audit, service: new AdminOperationsService(confirmations as never, stepUp as never, profiles as never, directory as never, sessions as never, keys as never, audit as never, readsAudit as never) };
}

describe("AdminOperationsService", () => {
  it("atomically cascades suspend through sessions and keys", async () => {
    const test = setup();
    await test.service.execute(actor, targetId, { action: "suspend_account", reason: "security review", confirmationId: "intent", password: "secret" });
    expect(test.profiles.setAdministrativeState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "suspended" }));
    expect(test.sessions.revokeAllInTransaction).toHaveBeenCalledOnce();
    expect(test.keys.revokeAllInTransaction).toHaveBeenCalledOnce();
    expect(test.audit.audit).toHaveBeenCalledOnce();
  });

  it("restore changes only administrative state and never recreates credentials", async () => {
    const test = setup();
    await test.service.execute(actor, targetId, { action: "restore_account", reason: "review complete", confirmationId: "intent", password: "secret" });
    expect(test.profiles.setAdministrativeState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "active" }));
    expect(test.sessions.revokeAllInTransaction).not.toHaveBeenCalled();
    expect(test.keys.revokeAllInTransaction).not.toHaveBeenCalled();
  });

  it("exports bounded metadata without password step-up", async () => {
    const test = setup();
    test.profiles.lockState.mockResolvedValue({
      id: targetId,
      username: "target",
      status: "active",
      administrativeState: "active",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    await expect(test.service.execute(actor, targetId, {
      action: "export_account",
      reason: "administrative export",
      confirmationId: "intent",
    })).resolves.toMatchObject({ kind: "administrative_account_metadata_snapshot" });
    expect(test.stepUp.verifyPassword).not.toHaveBeenCalled();
  });

  it("rejects a critical operation without password step-up", async () => {
    const test = setup();
    await expect(test.service.execute(actor, targetId, {
      action: "suspend_account",
      reason: "security review",
      confirmationId: "intent",
    })).rejects.toThrow("Подтверждение не прошло");
  });

});
