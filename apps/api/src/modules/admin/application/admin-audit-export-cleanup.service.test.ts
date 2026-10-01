import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAuditExportCleanupService } from "./admin-audit-export-cleanup.service.ts";
describe("AdminAuditExportCleanupService", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("runs bounded repeatable cleanup, retries failures, and stops", async () => {
    vi.useFakeTimers(); const repository = { deleteExpired: vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValue(0) };
    const service = new AdminAuditExportCleanupService(repository); service.onModuleInit();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(repository.deleteExpired).toHaveBeenNthCalledWith(1, 100); expect(repository.deleteExpired).toHaveBeenCalledTimes(2);
    service.onModuleDestroy(); await vi.advanceTimersByTimeAsync(5 * 60 * 1000); expect(repository.deleteExpired).toHaveBeenCalledTimes(2);
  });

  it("logs only fixed lifecycle messages without export payloads or filters", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const repository = {
      deleteExpired: vi.fn().mockResolvedValueOnce(3).mockRejectedValueOnce(new Error("private repository failure")),
    };
    const service = new AdminAuditExportCleanupService(repository);

    await service.run();
    await service.run();

    expect(log.mock.calls).toEqual([["Expired audit exports removed"]]);
    expect(warn.mock.calls).toEqual([["Expired audit export cleanup failed; it will retry"]]);
    expect(`${JSON.stringify(log.mock.calls)}${JSON.stringify(warn.mock.calls)}`).not.toMatch(/private repository failure|payload|filters/i);
  });
});
