import { Inject, Injectable } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { Permissions, PermissionsService } from "../../permissions/public/index.ts";

@Injectable()
export class SanctionsAuthorizationService {
  constructor(@Inject(PermissionsService) private readonly permissions: PermissionsService) {}

  canManageSanctions(userId: UserId): Promise<boolean> {
    return this.permissions.hasPermission(userId, Permissions.MODERATION_MANAGE_SANCTIONS);
  }

  canResolveAppeal(userId: UserId): Promise<boolean> {
    return this.permissions.hasPermission(userId, Permissions.MODERATION_RESOLVE_APPEAL);
  }

  canViewReports(userId: UserId): Promise<boolean> {
    return this.permissions.hasPermission(userId, Permissions.MODERATION_VIEW_REPORTS);
  }

  async canViewUserSanctions(requesterId: UserId, targetId: UserId): Promise<boolean> {
    if (requesterId === targetId) return this.permissions.isActiveUser(requesterId);
    return this.canViewReports(requesterId);
  }

  canViewAppeals(requesterId: UserId, sanctionOwnerId: UserId): Promise<boolean> {
    return this.canViewUserSanctions(requesterId, sanctionOwnerId);
  }
}
