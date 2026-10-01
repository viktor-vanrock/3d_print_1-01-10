import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { OrganizationsController } from "./organizations.controller.ts";
import { REQUIRED_PERMISSION_KEY } from "../../permissions/guards/permission.guard.ts";
import { Permissions } from "../../permissions/domain/permissions.catalog.ts";

function route(name: keyof OrganizationsController) {
  const handler = OrganizationsController.prototype[name];
  if (typeof handler !== "function") throw new Error(String(name));
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    path: (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "",
  };
}

describe("OrganizationsController route inventory", () => {
  it("covers all six authoritative organizations routes", () => {
    expect([route("claimCommunityOwner"), route("submitClaim"), route("ownClaims"), route("reviewQueue"), route("verifyClaim"), route("revokeClaim")]).toEqual([
      { method: RequestMethod.POST, path: "communities/:id/claim-owner" },
      { method: RequestMethod.POST, path: "vendor-claims" },
      { method: RequestMethod.GET, path: "vendor-claims/mine" },
      { method: RequestMethod.GET, path: "vendor-claims" },
      { method: RequestMethod.POST, path: "vendor-claims/:id/verify" },
      { method: RequestMethod.POST, path: "vendor-claims/:id/revoke" },
    ]);
  });
  it.each(["reviewQueue", "verifyClaim", "revokeClaim"] as const)("declares exact vendor-claim permission on %s", (method) => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, OrganizationsController.prototype[method])).toBe(Permissions.CATALOG_REVIEW_VENDOR_CLAIMS);
  });
});
