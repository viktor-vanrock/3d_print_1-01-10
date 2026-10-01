import { describe, expect, it } from "vitest";
import { AccessMode } from "../../permissions/domain/access-mode.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";
import { ACCESS_MODE_KEY, REQUIRED_PERMISSION_KEY } from "../../permissions/guards/permission.guard.ts";
import { SanctionsController } from "./sanctions.controller.ts";

describe("SanctionsController authorization metadata", () => {
  it.each(["create", "cancel"] as const)("protects %s with manage-sanctions permission", (method) => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, SanctionsController.prototype[method])).toBe(AccessMode.PERMISSION);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, SanctionsController.prototype[method])).toBe(Permissions.MODERATION_MANAGE_SANCTIONS);
  });

  it.each(["active", "history"] as const)("requires an active user for %s and delegates self-or-privileged policy", (method) => {
    expect(Reflect.getMetadata(ACCESS_MODE_KEY, SanctionsController.prototype[method])).toBe(AccessMode.USER);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, SanctionsController.prototype[method])).toBeUndefined();
  });
});
