import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

export interface AdminAuditExportCleanupRepository { deleteExpired(limit: number): Promise<number> }

@Injectable()
export class AdminAuditExportCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminAuditExportCleanupService.name);
  private timer: NodeJS.Timeout | null = null;
  constructor(@Inject("ADMIN_AUDIT_EXPORT_CLEANUP_REPOSITORY") private readonly repository: AdminAuditExportCleanupRepository) {}
  onModuleInit(): void { this.timer = setInterval(() => void this.run(), 5 * 60 * 1000); this.timer.unref(); }
  onModuleDestroy(): void { if (this.timer !== null) clearInterval(this.timer); this.timer = null; }
  async run(): Promise<void> { try { const deleted = await this.repository.deleteExpired(100); if (deleted > 0) this.logger.log("Expired audit exports removed"); } catch { this.logger.warn("Expired audit export cleanup failed; it will retry"); } }
}
