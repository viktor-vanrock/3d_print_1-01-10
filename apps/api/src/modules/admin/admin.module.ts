import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../nest/database/database.module.ts";
import { PermissionsModule } from "../permissions/public/index.ts";
import { AdminController } from "./api/admin.controller.ts";
import { AdminReadService } from "./application/admin-read.service.ts";
import { AdminAuditRepository } from "./infrastructure/admin-audit.repository.ts";
import { AdminAccessService } from "./application/admin-access.service.ts";
import { AdminOperationsService } from "./application/admin-operations.service.ts";
import { AdminConfirmationRepository } from "./infrastructure/admin-confirmation.repository.ts";
import { AdminAuditReadService } from "./application/admin-audit-read.service.ts";
import { AdminAuditExportService } from "./application/admin-audit-export.service.ts";
import { AdminAuditExportPostgresRepository } from "./infrastructure/admin-audit-export.repository.ts";
import { AdminAuditExportCleanupService } from "./application/admin-audit-export-cleanup.service.ts";

@Module({
  imports: [DatabaseModule, PermissionsModule],
  controllers: [AdminController],
  providers: [
    AdminAccessService, AdminOperationsService, AdminConfirmationRepository, AdminAuditRepository, AdminReadService, AdminAuditReadService,
    AdminAuditExportService, AdminAuditExportPostgresRepository, AdminAuditExportCleanupService,
    { provide: "ADMIN_AUDIT_READ_REPOSITORY", useExisting: AdminAuditRepository },
    { provide: "ADMIN_AUDIT_EXPORT_REPOSITORY", useExisting: AdminAuditExportPostgresRepository },
    { provide: "ADMIN_AUDIT_EXPORT_CLEANUP_REPOSITORY", useExisting: AdminAuditExportPostgresRepository },
  ],
})
export class AdminModule {}
