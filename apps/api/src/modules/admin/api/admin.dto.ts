import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import {
  ALL_PERMISSIONS,
  type PermissionCategory,
  type PermissionConfirmation,
  type PermissionRisk,
  type PermissionScopeKind,
  type Permissions,
} from "../../permissions/public/index.ts";

export class AdminGlobalScopeDto {
  @ApiProperty({ enum: ["global"] }) declare readonly kind: "global";
}

export class AdminCommunityScopeDto {
  @ApiProperty({ enum: ["community"] }) declare readonly kind: "community";
  @ApiProperty({ type: String }) declare readonly communityId: string;
}

export class AdminVendorScopeDto {
  @ApiProperty({ enum: ["vendor"] }) declare readonly kind: "vendor";
  @ApiProperty({ type: String }) declare readonly vendorId: string;
}

export class AdminCatalogScopeDto {
  @ApiProperty({ enum: ["catalog"] }) declare readonly kind: "catalog";
  @ApiProperty({ enum: ["materials", "printers"] }) declare readonly catalog: "materials" | "printers";
}

export class AdminUserScopeDto {
  @ApiProperty({ enum: ["user"] }) declare readonly kind: "user";
  @ApiProperty({ type: String }) declare readonly userId: string;
}

export type AdminPermissionScopeDto =
  | AdminGlobalScopeDto
  | AdminCommunityScopeDto
  | AdminVendorScopeDto
  | AdminCatalogScopeDto
  | AdminUserScopeDto;

export class AdminEffectivePermissionDto {
  @ApiProperty({ enum: ALL_PERMISSIONS }) declare readonly key: Permissions;
  @ApiProperty({
    oneOf: [AdminGlobalScopeDto, AdminCommunityScopeDto, AdminVendorScopeDto, AdminCatalogScopeDto, AdminUserScopeDto].map((type) => ({
      $ref: getSchemaPath(type),
    })),
  })
  declare readonly scope: AdminPermissionScopeDto;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly expires_at: string | null;
}

export class AdminMeResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly user_id: string;
  @ApiProperty({ type: [AdminEffectivePermissionDto] }) declare readonly permissions: readonly AdminEffectivePermissionDto[];
}

export class AdminPermissionCatalogItemDto {
  @ApiProperty({ enum: ALL_PERMISSIONS }) declare readonly key: Permissions;
  @ApiProperty({ enum: ["admin", "users", "moderation", "analytics", "billing", "audit", "catalog", "feed", "research", "support"] })
  declare readonly category: PermissionCategory;
  @ApiProperty({ type: String }) declare readonly description: string;
  @ApiProperty({ enum: ["low", "medium", "high", "critical"] }) declare readonly risk: PermissionRisk;
  @ApiProperty({ type: Boolean }) declare readonly delegable: boolean;
  @ApiProperty({ type: Boolean }) declare readonly admin_assignable: boolean;
  @ApiProperty({ enum: ["global", "community", "vendor", "catalog", "user"], isArray: true })
  declare readonly allowed_scope_kinds: readonly PermissionScopeKind[];
  @ApiProperty({ enum: ["none", "confirm", "step_up"] }) declare readonly confirmation: PermissionConfirmation;
}

export class AdminPermissionCatalogResponseDto {
  @ApiProperty({ type: [AdminPermissionCatalogItemDto] }) declare readonly items: readonly AdminPermissionCatalogItemDto[];
}

const ADMIN_USER_STATUSES = ["active", "restricted", "deleted"] as const;

export class AdminUsersBrowseQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_USER_STATUSES })
  @IsOptional()
  @IsIn(ADMIN_USER_STATUSES)
  declare readonly status?: "active" | "restricted" | "deleted";

  @ApiPropertyOptional({ type: Number, default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly limit?: number;

  @ApiPropertyOptional({ type: String, maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  declare readonly cursor?: string;
}

export class AdminUsersSearchBodyDto extends AdminUsersBrowseQueryDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/\S/)
  declare readonly query: string;
}

export class AdminUserSummaryDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly username: string;
  @ApiProperty({ type: String, nullable: true }) declare readonly display_name: string | null;
  @ApiProperty({ enum: ADMIN_USER_STATUSES }) declare readonly status: "active" | "restricted" | "deleted";
  @ApiProperty({ enum: ["user", "admin", "superadmin"] }) declare readonly role: "user" | "admin" | "superadmin";
  @ApiProperty({ enum: ["active", "restricted", "suspended", "blocked", "closed"] })
  declare readonly account_state: "active" | "restricted" | "suspended" | "blocked" | "closed";
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: Boolean, enum: [true], description: "Sensitive identity and contact fields are omitted by the server" })
  declare readonly pii_masked: true;
}

export class AdminUsersPageDto {
  @ApiProperty({ type: [AdminUserSummaryDto] }) declare readonly items: readonly AdminUserSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) declare readonly next_cursor: string | null;
}

export class AdminUserCardDto extends AdminUserSummaryDto {
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
}

export class AdminSanctionSummaryDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ enum: ["suspension", "ban"] }) declare readonly type: "suspension" | "ban";
  @ApiProperty({ enum: ["active", "cancelled", "expired"] }) declare readonly state: "active" | "cancelled" | "expired";
  @ApiProperty({ enum: ["spam", "abuse", "fraud", "tos_violation", "security", "other"] }) declare readonly reason_code: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly starts_at: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly ends_at: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
  @ApiProperty({ type: Boolean, enum: [true] }) declare readonly sensitive_details_masked: true;
}
export class AdminLatestSanctionsResponseDto {
  @ApiProperty({ type: [AdminSanctionSummaryDto], maxItems: 50 }) declare readonly items: readonly AdminSanctionSummaryDto[];
  @ApiProperty({ type: Boolean }) declare readonly has_earlier: boolean;
  @ApiProperty({ type: Number, enum: [50] }) declare readonly limit: 50;
}

export class AdminAuditQueryDto {
  @ApiPropertyOptional({ type: Number, default: 50, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare readonly limit?: number;
  @ApiPropertyOptional({ type: String, maxLength: 2048 }) @IsOptional() @IsString() @MaxLength(2048)
  declare readonly cursor?: string;
  @ApiPropertyOptional({ type: String, maxLength: 160 }) @IsOptional() @IsString() @MaxLength(160)
  declare readonly action?: string;
  @ApiPropertyOptional({ type: String, maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80)
  declare readonly target_type?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @IsOptional() @IsUUID()
  declare readonly actor_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @IsOptional() @IsUUID()
  declare readonly target_id?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) @IsOptional() @IsISO8601()
  declare readonly from?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) @IsOptional() @IsISO8601()
  declare readonly to?: string;
}

export class AdminAuditMetadataDto {
  @ApiPropertyOptional({ type: String }) declare readonly outcome?: string;
  @ApiPropertyOptional({ type: String }) declare readonly status?: string;
  @ApiPropertyOptional({ enum: ALL_PERMISSIONS }) declare readonly permission?: Permissions;
  @ApiPropertyOptional({ type: String }) declare readonly provenance?: string;
  @ApiPropertyOptional({ type: Number }) declare readonly count?: number;
  @ApiPropertyOptional({ type: Number }) declare readonly created?: number;
  @ApiPropertyOptional({ type: Number }) declare readonly skipped?: number;
  @ApiPropertyOptional({ type: Number }) declare readonly version?: number;
  @ApiPropertyOptional({ type: Number }) declare readonly from_version?: number;
}

export class AdminAuditEventDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly actor_user_id: string;
  @ApiProperty({ type: String }) declare readonly action: string;
  @ApiProperty({ type: String }) declare readonly target_type: string;
  @ApiProperty({ type: String, format: "uuid" }) declare readonly target_id: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: AdminAuditMetadataDto }) declare readonly metadata: AdminAuditMetadataDto;
  @ApiProperty({ type: Boolean, enum: [true] }) declare readonly details_masked: true;
}

export class AdminAuditRangeDto {
  @ApiProperty({ type: String, format: "date-time" }) declare readonly from: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly to: string;
}

export class AdminAuditPageDto {
  @ApiProperty({ type: [AdminAuditEventDto], maxItems: 100 }) declare readonly items: readonly AdminAuditEventDto[];
  @ApiProperty({ type: String, nullable: true }) declare readonly next_cursor: string | null;
  @ApiProperty({ type: AdminAuditRangeDto }) declare readonly range: AdminAuditRangeDto;
}

export class AdminAuditExportCreateDto {
  @ApiPropertyOptional({ type: String, format: "date-time" }) @IsOptional() @IsISO8601() declare readonly from?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) @IsOptional() @IsISO8601() declare readonly to?: string;
  @ApiPropertyOptional({ type: String, maxLength: 160 }) @IsOptional() @IsString() @MaxLength(160) declare readonly action?: string;
  @ApiPropertyOptional({ type: String, maxLength: 80 }) @IsOptional() @IsString() @MaxLength(80) declare readonly target_type?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @IsOptional() @IsUUID() declare readonly actor_id?: string;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @IsOptional() @IsUUID() declare readonly target_id?: string;
  @ApiPropertyOptional({ type: String, maxLength: 4096 }) @IsOptional() @IsString() @MaxLength(4096) declare readonly cursor?: string;
}
export class AdminAuditExportCreatedDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ enum: ["ready"] }) declare readonly status: "ready";
  @ApiProperty({ type: Number, maximum: 10000 }) declare readonly event_count: number;
  @ApiProperty({ type: Number, maximum: 5242880 }) declare readonly byte_size: number;
  @ApiProperty({ type: Boolean }) declare readonly truncated: boolean;
  @ApiProperty({ type: String }) declare readonly sha256: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly expires_at: string;
  @ApiProperty({ type: String }) declare readonly download_url: string;
  @ApiProperty({ type: String, nullable: true }) declare readonly next_cursor: string | null;
}
export class AdminAuditExportDocumentDto {
  @ApiProperty({ enum: ["admin-audit-export.v1"] }) declare readonly schema_version: "admin-audit-export.v1";
  @ApiProperty({ type: String, format: "uuid" }) declare readonly export_id: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly expires_at: string;
  @ApiProperty({ type: AdminAuditRangeDto }) declare readonly range: AdminAuditRangeDto;
  @ApiProperty({ type: Number, maximum: 10000 }) declare readonly event_count: number;
  @ApiProperty({ type: Boolean }) declare readonly truncated: boolean;
  @ApiProperty({ type: String, nullable: true }) declare readonly next_cursor: string | null;
  @ApiProperty({ type: [AdminAuditEventDto], maxItems: 10000 }) declare readonly events: readonly AdminAuditEventDto[];
}
export class AdminPermissionChangePreviewDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/)
  declare readonly reason: string;

}

export class AdminPermissionChangeExecuteDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  declare readonly confirmation_id: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/)
  declare readonly reason: string;

  @ApiProperty({ type: String, format: "password", minLength: 1, maxLength: 1024 })
  @IsString() @MinLength(1) @MaxLength(1024)
  declare readonly password: string;
}

export class AdminGrantPermissionPreviewDto extends AdminPermissionChangePreviewDto {
  @ApiProperty({ enum: ALL_PERMISSIONS }) @IsIn(ALL_PERMISSIONS)
  declare readonly permission: Permissions;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsOptional() @ValidateIf((_object, value: unknown) => value !== null) @IsISO8601()
  declare readonly expires_at?: string | null;
}

export class AdminGrantPermissionExecuteDto extends AdminPermissionChangeExecuteDto {
  @ApiProperty({ enum: ALL_PERMISSIONS }) @IsIn(ALL_PERMISSIONS)
  declare readonly permission: Permissions;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  @IsOptional() @ValidateIf((_object, value: unknown) => value !== null) @IsISO8601()
  declare readonly expires_at?: string | null;
}

export class AdminRevokePermissionPreviewDto extends AdminPermissionChangePreviewDto {
  @ApiProperty({ type: String, format: "uuid" }) @IsUUID()
  declare readonly grant_id: string;
}

export class AdminRevokePermissionExecuteDto extends AdminPermissionChangeExecuteDto {
  @ApiProperty({ type: String, format: "uuid" }) @IsUUID()
  declare readonly grant_id: string;
}

export class AdminConfigureAccessPreviewDto extends AdminPermissionChangePreviewDto {
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true })
  declare readonly permissions: readonly Permissions[];
}
export class AdminConfigureAccessExecuteDto extends AdminConfigureAccessPreviewDto {
  @ApiProperty({ type: String, format: "uuid" }) @IsUUID()
  declare readonly confirmation_id: string;
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true })
  declare readonly permissions: readonly Permissions[];
}

export class AdminPermissionChangeEffectDto {
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly grant_id: string | null;
  @ApiProperty({ enum: ALL_PERMISSIONS }) declare readonly permission: Permissions;
  @ApiProperty({ enum: ["admin_assignment", "direct"] }) declare readonly provenance: "admin_assignment" | "direct";
}

export class AdminPermissionChangeEffectsDto {
  @ApiProperty({ type: [AdminPermissionChangeEffectDto] }) declare readonly added: readonly AdminPermissionChangeEffectDto[];
  @ApiProperty({ type: [AdminPermissionChangeEffectDto] }) declare readonly revoked: readonly AdminPermissionChangeEffectDto[];
  @ApiProperty({ type: [AdminPermissionChangeEffectDto] }) declare readonly retained: readonly AdminPermissionChangeEffectDto[];
}

export class AdminPermissionChangePreviewResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly confirmation_id: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly expires_at: string;
  @ApiProperty({ type: AdminPermissionChangeEffectsDto }) declare readonly effects: AdminPermissionChangeEffectsDto;
}

export class AdminPermissionChangeResultDto {
  @ApiProperty({ enum: ["configure_access", "assign_admin", "remove_admin_assignment", "revoke_all_admin_access", "grant_permission", "revoke_permission"] })
  declare readonly action: string;
  @ApiProperty({ type: [String], format: "uuid" }) declare readonly created_grant_ids: readonly string[];
  @ApiProperty({ type: [String], format: "uuid" }) declare readonly revoked_grant_ids: readonly string[];
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) declare readonly remaining_direct_permissions: readonly Permissions[];
}

export class AdminAccessGrantDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ enum: ALL_PERMISSIONS }) declare readonly permission: Permissions;
  @ApiProperty({ type: AdminGlobalScopeDto }) declare readonly scope: AdminPermissionScopeDto;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly expires_at: string | null;
  @ApiProperty({ enum: ["admin_assignment", "direct"] }) declare readonly provenance: "admin_assignment" | "direct";
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare readonly assignment_id: string | null;
}

export class AdminAssignmentAccessStateDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly preset_key: string;
  @ApiProperty({ type: Number }) declare readonly preset_version: number;
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) declare readonly preset_snapshot: readonly Permissions[];
  @ApiProperty({ type: String, format: "date-time" }) declare readonly assigned_at: string;
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) declare readonly missing_snapshot_permissions: readonly Permissions[];
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) declare readonly additional_direct_permissions: readonly Permissions[];
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) declare readonly current_preset_added: readonly Permissions[];
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) declare readonly current_preset_removed: readonly Permissions[];
}

export class AdminPresetDto {
  @ApiProperty({ type: String }) declare readonly key: string;
  @ApiProperty({ type: Number }) declare readonly version: number;
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true }) declare readonly permissions: readonly Permissions[];
}

export class AdminUserAccessStateDto {
  @ApiProperty({ type: AdminPresetDto })
  declare readonly admin_preset: { readonly key: string; readonly version: number; readonly permissions: readonly Permissions[] };
  @ApiProperty({ type: AdminAssignmentAccessStateDto, nullable: true }) declare readonly assignment: AdminAssignmentAccessStateDto | null;
  @ApiProperty({ type: [AdminAccessGrantDto] }) declare readonly grants: readonly AdminAccessGrantDto[];
}

export class AdminOperationPreviewDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 500 })
  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/)
  declare readonly reason: string;
}
export class AdminOperationExecuteDto extends AdminOperationPreviewDto {
  @ApiProperty({ type: String, format: "uuid" }) @IsUUID() declare readonly confirmation_id: string;
  @ApiPropertyOptional({ type: String, format: "password", minLength: 1, maxLength: 1024 })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(1024) declare readonly password?: string;
}
export class AdminOperationEffectsDto {
  @ApiProperty({ enum: ["suspend_account", "block_account", "restore_account", "delete_account", "export_account", "revoke_session", "revoke_api_key", "rotate_api_key"] }) declare readonly action: string;
  @ApiProperty({ type: [String], format: "uuid" }) declare readonly sessions_revoked: readonly string[];
  @ApiProperty({ type: [String], format: "uuid" }) declare readonly keys_revoked: readonly string[];
  @ApiProperty({ type: [String] }) declare readonly retained: readonly string[];
}
export class AdminOperationPreviewResponseDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly confirmation_id: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly expires_at: string;
  @ApiProperty({ type: AdminOperationEffectsDto }) declare readonly effects: AdminOperationEffectsDto;
}
export class AdminExportAccountDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String }) declare readonly username: string;
  @ApiProperty({ enum: ["active", "restricted", "deleted"] }) declare readonly status: string;
  @ApiProperty({ enum: ["active", "suspended", "blocked"] }) declare readonly administrative_state: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly updated_at: string;
}
export class AdminExportSessionDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly expires_at: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly revoked_at: string | null;
}
export class AdminExportApiKeyDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ enum: ["api_key", "user_api_key"] }) declare readonly kind: string;
  @ApiProperty({ type: String }) declare readonly label: string;
  @ApiProperty({ type: String }) declare readonly prefix: string;
  @ApiProperty({ enum: ["active", "revoked"] }) declare readonly status: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
}
export class AdminExportLimitsDto {
  @ApiProperty({ type: Number, enum: [50] }) declare readonly sessions: number;
  @ApiProperty({ type: Number, enum: [50] }) declare readonly api_keys: number;
}
export class AdminOperationResultDto {
  @ApiPropertyOptional({ enum: ["suspend_account", "block_account", "restore_account", "delete_account", "revoke_session", "revoke_api_key", "rotate_api_key"] })
  declare readonly action?: string;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) declare readonly sessions_revoked?: number;
  @ApiPropertyOptional({ type: Number, minimum: 0 }) declare readonly keys_revoked?: number;
  @ApiPropertyOptional({ type: String, format: "uuid" }) declare readonly key_id?: string;
  @ApiPropertyOptional({ type: String, description: "Non-secret key prefix" }) declare readonly key_prefix?: string;
  @ApiPropertyOptional({ type: String, description: "Returned once after a successful key rotation" }) declare readonly secret?: string;
  @ApiPropertyOptional({ enum: ["administrative_account_metadata_snapshot"] }) declare readonly kind?: string;
  @ApiPropertyOptional({ type: String, format: "date-time" }) declare readonly generated_at?: string;
  @ApiPropertyOptional({ type: AdminExportAccountDto }) declare readonly account?: AdminExportAccountDto;
  @ApiPropertyOptional({ type: [AdminExportSessionDto], maxItems: 50 }) declare readonly sessions?: readonly AdminExportSessionDto[];
  @ApiPropertyOptional({ type: [AdminExportApiKeyDto], maxItems: 50 }) declare readonly api_keys?: readonly AdminExportApiKeyDto[];
  @ApiPropertyOptional({ type: AdminExportLimitsDto }) declare readonly limits?: AdminExportLimitsDto;
}
export class AdminBrowserSessionDto {
  @ApiProperty({ type: String, format: "uuid" }) declare readonly id: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly created_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly expires_at: string;
  @ApiProperty({ type: String, format: "date-time" }) declare readonly last_seen_at: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare readonly revoked_at: string | null;
}
export class AdminBrowserSessionsResponseDto { @ApiProperty({ type: [AdminBrowserSessionDto], maxItems: 50 }) declare readonly items: readonly AdminBrowserSessionDto[]; }
