import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiExtraModels, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Type } from "@nestjs/common";
import { ApiErrorEnvelopeDto } from "../../../nest/openapi/error-envelope.dto.ts";
import { ApiSessionProtected } from "../../../nest/openapi/api-session-protected.ts";
import {
  AdminCatalogScopeDto,
  AdminCommunityScopeDto,
  AdminGlobalScopeDto,
  AdminMeResponseDto,
  AdminPermissionCatalogResponseDto,
  AdminUserCardDto,
  AdminUsersBrowseQueryDto,
  AdminUsersPageDto,
  AdminUsersSearchBodyDto,
  AdminUserScopeDto,
  AdminVendorScopeDto,
  AdminPermissionChangePreviewResponseDto,
  AdminPermissionChangeResultDto,
  AdminUserAccessStateDto,
  AdminLatestSanctionsResponseDto,
  AdminBrowserSessionDto,
  AdminBrowserSessionsResponseDto,
  AdminOperationExecuteDto,
  AdminOperationPreviewDto,
  AdminOperationPreviewResponseDto,
  AdminOperationResultDto,
  AdminAuditPageDto,
  AdminAuditQueryDto,
  AdminAuditExportCreateDto,
  AdminAuditExportCreatedDto,
  AdminAuditExportDocumentDto,
} from "./admin.dto.ts";

export function ApiAdminAuditEventsOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"), ApiOperation({ summary: "Browse bounded masked administrative audit events" }),
    ApiSessionProtected(), ApiQuery({ type: AdminAuditQueryDto }),
    ApiResponse({ status: 200, type: AdminAuditPageDto }), ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 500, type: ApiErrorEnvelopeDto }),
  );
}

export function ApiAdminAuditExportCreateOperation(): MethodDecorator {
  return applyDecorators(ApiTags("admin"), ApiOperation({ summary: "Create a bounded masked audit export segment" }), ApiSessionProtected(),
    ApiBody({ type: AdminAuditExportCreateDto }), ApiResponse({ status: 201, type: AdminAuditExportCreatedDto }),
    ApiResponse({ status: 400, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 429, type: ApiErrorEnvelopeDto }));
}
export function ApiAdminAuditExportDownloadOperation(): MethodDecorator {
  return applyDecorators(ApiTags("admin"), ApiOperation({ summary: "Download a previously created masked audit export" }), ApiSessionProtected(),
    ApiParam({ name: "id", type: String, format: "uuid" }), ApiResponse({ status: 200, description: "Exact JSON export bytes", type: AdminAuditExportDocumentDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 410, type: ApiErrorEnvelopeDto }));
}

export function ApiAdminMeOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"),
    ApiOperation({ summary: "Read the current administrator permission context" }),
    ApiSessionProtected(),
    ApiExtraModels(AdminGlobalScopeDto, AdminCommunityScopeDto, AdminVendorScopeDto, AdminCatalogScopeDto, AdminUserScopeDto),
    ApiResponse({ status: 200, type: AdminMeResponseDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 500, type: ApiErrorEnvelopeDto }),
  );
}

function adminUserReadResponses(): MethodDecorator {
  return applyDecorators(
    ApiSessionProtected(),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 500, type: ApiErrorEnvelopeDto }),
  );
}

export function ApiAdminUsersBrowseOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"),
    ApiOperation({ summary: "Browse user accounts with bounded keyset pagination" }),
    ApiQuery({ type: AdminUsersBrowseQueryDto }),
    adminUserReadResponses(),
    ApiResponse({ status: 200, type: AdminUsersPageDto }),
  );
}

export function ApiAdminUsersSearchOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"),
    ApiOperation({ summary: "Search user accounts without placing search terms in the URL" }),
    ApiBody({ type: AdminUsersSearchBodyDto }),
    adminUserReadResponses(),
    ApiResponse({ status: 200, type: AdminUsersPageDto }),
  );
}

export function ApiAdminUserOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"),
    ApiOperation({ summary: "Read a masked basic user account card" }),
    ApiParam({ name: "id", type: String, format: "uuid" }),
    adminUserReadResponses(),
    ApiResponse({ status: 200, type: AdminUserCardDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
  );
}

export function ApiAdminPermissionCatalogOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"),
    ApiOperation({ summary: "Read the platform permission catalog" }),
    ApiSessionProtected(),
    ApiResponse({ status: 200, type: AdminPermissionCatalogResponseDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 500, type: ApiErrorEnvelopeDto }),
  );
}

export function ApiAdminPermissionChangePreviewOperation(summary: string, bodyType: Type<unknown>): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"), ApiOperation({ summary }), ApiSessionProtected(), ApiBody({ type: bodyType }),
    ApiResponse({ status: 201, type: AdminPermissionChangePreviewResponseDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}

export function ApiAdminPermissionChangeExecuteOperation(summary: string, bodyType: Type<unknown>): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"), ApiOperation({ summary }), ApiSessionProtected(), ApiBody({ type: bodyType }),
    ApiResponse({ status: 201, type: AdminPermissionChangeResultDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }),
  );
}

export function ApiAdminUserAccessStateOperation(): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"), ApiOperation({ summary: "Read effective grants, Admin assignment provenance and drift" }),
    ApiSessionProtected(), ApiParam({ name: "id", type: String, format: "uuid" }),
    ApiResponse({ status: 200, type: AdminUserAccessStateDto }),
    ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
  );
}

export function ApiAdminUserSectionOperation(summary: string, responseType: Type<unknown>): MethodDecorator {
  return applyDecorators(
    ApiTags("admin"), ApiOperation({ summary }), ApiSessionProtected(), ApiParam({ name: "id", type: String, format: "uuid" }),
    ApiResponse({ status: 200, type: responseType }), ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 404, type: ApiErrorEnvelopeDto }),
  );
}

export const ADMIN_USER_SECTION_RESPONSES = {
  sanctions: AdminLatestSanctionsResponseDto,
} as const;

export function ApiAdminOperationPreview(summary: string): MethodDecorator {
  return applyDecorators(ApiTags("admin"), ApiOperation({ summary }), ApiSessionProtected(), ApiBody({ type: AdminOperationPreviewDto }),
    ApiResponse({ status: 201, type: AdminOperationPreviewResponseDto }), ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }));
}
export function ApiAdminOperationExecute(summary: string): MethodDecorator {
  return applyDecorators(ApiTags("admin"), ApiOperation({ summary }), ApiSessionProtected(), ApiBody({ type: AdminOperationExecuteDto }),
    ApiResponse({ status: 201, type: AdminOperationResultDto }), ApiResponse({ status: 403, type: ApiErrorEnvelopeDto }),
    ApiResponse({ status: 409, type: ApiErrorEnvelopeDto }), ApiResponse({ status: 422, type: ApiErrorEnvelopeDto }));
}
export function ApiAdminResourceOperationPreview(summary: string): MethodDecorator {
  return applyDecorators(ApiParam({ name: "id", type: String, format: "uuid" }), ApiParam({ name: "resourceId", type: String, format: "uuid" }), ApiAdminOperationPreview(summary));
}
export function ApiAdminResourceOperationExecute(summary: string): MethodDecorator {
  return applyDecorators(ApiParam({ name: "id", type: String, format: "uuid" }), ApiParam({ name: "resourceId", type: String, format: "uuid" }), ApiAdminOperationExecute(summary));
}
export function ApiAdminSessionsOperation(): MethodDecorator {
  return applyDecorators(ApiTags("admin"), ApiOperation({ summary: "Read bounded browser-session metadata" }), ApiSessionProtected(),
    ApiExtraModels(AdminBrowserSessionDto), ApiResponse({ status: 200, type: AdminBrowserSessionsResponseDto }));
}
