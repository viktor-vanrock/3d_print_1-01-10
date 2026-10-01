import { describe, expect, it } from "vitest";
import openapi from "./openapi.v1.json";

describe("admin user directory contract", () => {
  it("publishes browse, body-based search and basic card operations", () => {
    expect(openapi.paths["/v1/admin/users"]?.get).toBeDefined();
    expect(openapi.paths["/v1/admin/users/search"]?.post?.requestBody).toBeDefined();
    expect(openapi.paths["/v1/admin/users/{id}"]?.get).toBeDefined();
    expect(openapi.paths["/v1/admin/users/{id}/access"]?.get).toBeDefined();
    expect(openapi.paths["/v1/admin/users/{id}/sanctions"]?.get).toBeDefined();
  });

  it("keeps sensitive user-card projections explicit, bounded and secret-free", () => {
    expect(openapi.components.schemas.AdminLatestSanctionsResponseDto.properties.items.maxItems).toBe(50);
    expect(openapi.components.schemas.AdminLatestSanctionsResponseDto.properties).toHaveProperty("has_earlier");
    const projections = JSON.stringify({
      sanctions: openapi.components.schemas.AdminLatestSanctionsResponseDto,
    });
    expect(projections).not.toMatch(/identifier_hash|password_hash|s3_key|reason_note|evidence_url|token/i);
  });

  it("does not expose free-text search as a GET query parameter", () => {
    const parameters = openapi.paths["/v1/admin/users"]?.get?.parameters ?? [];
    expect(parameters.map((parameter) => "$ref" in parameter ? parameter.$ref : parameter.name)).not.toContain("query");
  });

  it("does not publish retired identity lookup and credential endpoints", () => {
    expect(Object.hasOwn(openapi.paths, "/v1/admin/users/lookup-identity")).toBe(false);
    expect(Object.hasOwn(openapi.paths, "/v1/admin/users/{id}/credentials")).toBe(false);
    expect(Object.hasOwn(openapi.paths, "/v1/admin/users/{id}/identities")).toBe(false);
    expect(Object.hasOwn(openapi.components.schemas, "AdminIdentityLookupBodyDto")).toBe(false);
    expect(Object.hasOwn(openapi.components.schemas, "AdminCredentialSummaryDto")).toBe(false);
    expect(Object.hasOwn(openapi.components.schemas, "AdminIdentityMetadataResponseDto")).toBe(false);
  });

  it("publishes separate preview/execute contracts for every permission mutation", () => {
    const paths = [
      ["/v1/admin/users/{id}/admin-assignment/preview", "/v1/admin/users/{id}/admin-assignment/execute"],
      ["/v1/admin/users/{id}/admin-assignment/remove/preview", "/v1/admin/users/{id}/admin-assignment/remove/execute"],
      ["/v1/admin/users/{id}/admin-access/revoke-all/preview", "/v1/admin/users/{id}/admin-access/revoke-all/execute"],
      ["/v1/admin/users/{id}/permissions/grant/preview", "/v1/admin/users/{id}/permissions/grant/execute"],
      ["/v1/admin/users/{id}/permissions/revoke/preview", "/v1/admin/users/{id}/permissions/revoke/execute"],
    ] as const;
    for (const [preview, execute] of paths) {
      expect(openapi.paths[preview].post.requestBody).toBeDefined();
      expect(openapi.paths[execute].post.requestBody).toBeDefined();
    }
    expect(openapi.components.schemas.AdminPermissionChangePreviewDto.required).toEqual(["reason"]);
    expect(openapi.components.schemas.AdminPermissionChangePreviewDto.properties).not.toHaveProperty("password");
    expect(openapi.components.schemas.AdminPermissionChangeExecuteDto.required).toEqual(expect.arrayContaining(["confirmation_id", "reason", "password"]));
    expect(openapi.components.schemas.AdminPermissionChangePreviewResponseDto.properties).toHaveProperty("effects");
  });

  it("publishes bounded Step 6 reads and preview/execute account and session operations", () => {
    expect(openapi.paths["/v1/admin/users/{id}/sessions"]?.get?.responses?.["200"]).toBeDefined();
    const operationPaths = [
      "/v1/admin/users/{id}/account/suspend",
      "/v1/admin/users/{id}/account/block",
      "/v1/admin/users/{id}/account/restore",
      "/v1/admin/users/{id}/account/close",
      "/v1/admin/users/{id}/export",
      "/v1/admin/users/{id}/sessions/{resourceId}/revoke",
    ] as const;
    for (const path of operationPaths) {
      const preview = openapi.paths[`${path}/preview`].post;
      const execute = openapi.paths[`${path}/execute`].post;
      expect(preview.requestBody).toBeDefined();
      expect(execute.requestBody).toBeDefined();
      expect(execute.responses["201"].content["application/json"].schema).toEqual({ $ref: "#/components/schemas/AdminOperationResultDto" });
    }
    expect(openapi.components.schemas.AdminBrowserSessionsResponseDto.properties.items.maxItems).toBe(50);
  });

  it("does not publish retired API-key administration", () => {
    expect(Object.keys(openapi.paths).some((path) => path.startsWith("/v1/admin/users/{id}/api-keys"))).toBe(false);
    expect(Object.hasOwn(openapi.components.schemas, "AdminApiKeysResponseDto")).toBe(false);
  });

  it("publishes a bounded masked audit page without raw details", () => {
    expect(openapi.paths["/v1/admin/audit/events"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/AdminAuditPageDto",
    });
    expect(openapi.components.schemas.AdminAuditPageDto.properties.items.maxItems).toBe(100);
    const event = JSON.stringify(openapi.components.schemas.AdminAuditEventDto);
    expect(event).toContain("details_masked");
    expect(event).not.toMatch(/password|secret|token|identifier_hash|lookup_fingerprint/i);
  });
  it("does not publish retired analytics and system-health administration", () => {
    expect(Object.hasOwn(openapi.paths, "/v1/admin/system/health")).toBe(false);
    expect(Object.hasOwn(openapi.paths, "/v1/admin/analytics/export")).toBe(false);
    expect(Object.hasOwn(openapi.components.schemas, "AdminSystemHealthDto")).toBe(false);
    expect(Object.hasOwn(openapi.components.schemas, "AdminAnalyticsExportDocumentDto")).toBe(false);
  });
});
