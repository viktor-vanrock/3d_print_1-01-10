import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionsService } from "../../permissions/public/index.ts";
import { AuthRepository } from "../infrastructure/auth.repository.ts";
import { AdminBootstrapService } from "./admin-bootstrap.service.ts";

const adminId = UserId("11111111-1111-4111-8111-111111111111");

function harness(input: { readonly bindingMode?: "new_installation" | "existing_installation" | null; readonly permissionError?: Error } = {}) {
  const bindingMode = input.bindingMode ?? null;
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
  const repository = {
    hasAnyPasswordCredentialsInTransaction: vi.fn().mockResolvedValue(false),
    resolveSuperadminIdentityInTransaction: vi.fn().mockResolvedValue({
      id: adminId,
      username: "portal.admin",
      accountCreated: bindingMode === "new_installation",
      bindingCreated: bindingMode !== null,
      bindingMode,
    }),
    hasPasswordCredentialInTransaction: vi.fn().mockResolvedValue(true),
    passwordMatchesInTransaction: vi.fn().mockResolvedValue(true),
    bindExistingSuperadminIdentityInTransaction: vi.fn().mockResolvedValue(undefined),
    recoverSuperadminInTransaction: vi.fn().mockResolvedValue({ passwordCreated: false, passwordRotated: false, accountRecovered: false, sessionVersionChanged: false }),
  };
  const permissions = {
    hasAnyPermissionGrantsInTransaction: vi.fn().mockResolvedValue(false),
    hasCompleteBootstrapEvidenceInTransaction: vi.fn().mockResolvedValue(true),
    ensureBootstrapAdminPermissionsInTransaction: input.permissionError === undefined
      ? vi.fn().mockResolvedValue({ created: 0, skipped: 34 })
      : vi.fn().mockRejectedValue(input.permissionError),
    recordSuperadminBootstrapEventsInTransaction: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { info: vi.fn() };
  const config = new ConfigService({
    ADMIN_USERNAME: "portal.admin",
    ADMIN_PASSWORD: "long-admin-password",
  });
  const service = new AdminBootstrapService(
    config,
    pool,
    repository as unknown as AuthRepository,
    permissions as unknown as PermissionsService,
    logger as unknown as RuntimeLogger,
  );
  return { service, pool, client, query, repository, permissions, logger };
}

describe("AdminBootstrapService", () => {
  it("does nothing when Superadmin credentials are not configured", async () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    const service = new AdminBootstrapService(
      new ConfigService({}),
      pool,
      {} as AuthRepository,
      {} as PermissionsService,
      { info: vi.fn() } as unknown as RuntimeLogger,
    );
    await service.onApplicationBootstrap();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("uses one transaction and reports a true no-op restart", async () => {
    const state = harness();
    await state.service.onApplicationBootstrap();
    expect(state.query.mock.calls.map(([sql]) => sql)).toEqual([
      "begin",
      expect.stringContaining("pg_advisory_xact_lock"),
      "commit",
    ]);
    expect(state.repository.recoverSuperadminInTransaction).toHaveBeenCalledWith(state.client, { userId: adminId, password: "long-admin-password" });
    expect(state.permissions.ensureBootstrapAdminPermissionsInTransaction).toHaveBeenCalledWith(state.client, adminId);
    expect(state.permissions.recordSuperadminBootstrapEventsInTransaction).toHaveBeenCalledWith(state.client, adminId, []);
    expect(state.logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining("no_op") }), "Superadmin is ready");
  });

  it("requires credential and complete bootstrap provenance for one-time existing binding", async () => {
    const state = harness({ bindingMode: "existing_installation" });
    state.permissions.hasCompleteBootstrapEvidenceInTransaction.mockResolvedValue(false);
    await expect(state.service.onApplicationBootstrap()).rejects.toThrow("binding evidence is incomplete");
    expect(state.repository.recoverSuperadminInTransaction).not.toHaveBeenCalled();
    expect(state.repository.bindExistingSuperadminIdentityInTransaction).not.toHaveBeenCalled();
    expect(state.permissions.ensureBootstrapAdminPermissionsInTransaction).not.toHaveBeenCalled();
    expect(state.query).toHaveBeenLastCalledWith("rollback");
  });

  it("rolls back account, credential and marker work when grant provisioning fails", async () => {
    const failure = new Error("grant audit unavailable");
    const state = harness({ bindingMode: "new_installation", permissionError: failure });
    await expect(state.service.onApplicationBootstrap()).rejects.toBe(failure);
    expect(state.query).toHaveBeenLastCalledWith("rollback");
    expect(state.permissions.recordSuperadminBootstrapEventsInTransaction).not.toHaveBeenCalled();
  });
});
