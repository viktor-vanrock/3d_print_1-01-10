import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { Permissions } from "../domain/permissions.catalog.ts";
import { AccessMode } from "../domain/access-mode.ts";
import { ACCESS_MODE_KEY, REQUIRED_PERMISSIONS_KEY } from "../guards/permission.guard.ts";

export const AllPermissions = (first: Permissions, ...rest: readonly Permissions[]) =>
  applyDecorators(
    SetMetadata(ACCESS_MODE_KEY, AccessMode.PERMISSION),
    SetMetadata(REQUIRED_PERMISSIONS_KEY, Object.freeze([first, ...rest])),
  );
