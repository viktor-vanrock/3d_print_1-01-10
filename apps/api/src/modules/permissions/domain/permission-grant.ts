import type { UserId } from "../../_kernel/brandedIds.ts";
import type { PermissionScope } from "./permission-scope.ts";
import type { Permissions } from "./permissions.catalog.ts";

export type { PermissionScope } from "./permission-scope.ts";

export class PermissionGrantAlreadyActiveError extends Error {
  constructor() {
    super("Permission grant is already active");
    this.name = "PermissionGrantAlreadyActiveError";
  }
}

export interface PermissionGrant {
  readonly id: string;
  readonly userId: UserId;
  readonly permission: Permissions;
  readonly scope: PermissionScope;
  readonly grantedBy: UserId;
  readonly reason: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: UserId | null;
  readonly revokeReason: string | null;
}
