import { Allow } from "class-validator";
import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from "@nestjs/swagger";
import { ASSISTANT_ERROR_CODES, type AssistantErrorCode, ASSISTANT_EVIDENCE_LIMITS, ASSISTANT_COMPARISON_FIELDS, ASSISTANT_EVIDENCE_ENTITY_TYPES, ASSISTANT_EVIDENCE_FRESHNESS_VALUES, ASSISTANT_EVIDENCE_QUALITY_VALUES } from "@portal/contracts/http/assistant";
import { RUN_RESULT_TYPES, RUN_STATUSES, type MessageRole, type RunResultType, type RunStatus } from "../domain/assistant.ts";

export class AssistantLooseBodyDto {
  @ApiPropertyOptional({ type: String }) @Allow() title?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() content?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() client_request_id?: unknown;
  @ApiPropertyOptional({ type: String, format: "uuid" }) @Allow() run_id?: unknown;
  @ApiPropertyOptional({ type: String }) @Allow() query?: unknown;
  @ApiPropertyOptional({ type: String, enum: ["home"] }) @Allow() context?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() limit?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() batch?: unknown;
  @ApiPropertyOptional({ type: [String] }) @Allow() exclude_labels?: unknown;
}

export class AssistantListQueryDto {
  @ApiPropertyOptional({ type: String }) @Allow() cursor?: unknown;
  @ApiPropertyOptional({ type: Number, minimum: 1 }) @Allow() limit?: unknown;
}

export class AssistantThreadDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, nullable: true }) declare title: string | null;
  @ApiProperty({ type: String, enum: ["chat", "device_incident"] }) declare kind: "chat" | "device_incident";
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare device_id: string | null;
  @ApiProperty({ type: String, enum: ["info", "warning", "critical"], nullable: true }) declare severity: "info" | "warning" | "critical" | null;
  @ApiProperty({ type: String, enum: ["open", "acknowledged", "resolved"], nullable: true }) declare incident_status: "open" | "acknowledged" | "resolved" | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare read_at: Date | null;
  @ApiProperty({ type: Boolean }) declare unread: boolean;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}
export class AssistantThreadResponseDto {
  @ApiProperty({ type: AssistantThreadDto }) declare thread: AssistantThreadDto;
}
export class AssistantThreadsResponseDto {
  @ApiProperty({ type: [AssistantThreadDto] }) declare items: readonly AssistantThreadDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}

export class AssistantMessageDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare thread_id: string;
  @ApiProperty({ type: String, enum: ["user", "assistant"] }) declare role: MessageRole;
  @ApiProperty({ type: String }) declare content: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare run_id: string | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
}
export class AssistantCitationDto {
  @ApiProperty({ type: String, format: "uuid" }) declare model_id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: String }) declare snippet: string;
  @ApiProperty({ type: Number }) declare score: number;
  @ApiProperty({ type: String, nullable: true }) declare source_url: string | null;
}

export class AssistantEvidenceSourceRefDto {
  @ApiProperty({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text }) declare label: string;
  @ApiProperty({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare url: string | null;
}
export class AssistantEvidencePriceFactDto {
  @ApiProperty({ type: Number }) declare amount: number;
  @ApiProperty({ type: String, enum: ["RUB", "USD"] }) declare currency: "RUB" | "USD";
}
export class AssistantPrinterBuildVolumeDto {
  @ApiProperty({ type: Number }) declare x: number;
  @ApiProperty({ type: Number }) declare y: number;
  @ApiProperty({ type: Number }) declare z: number;
}
export class AssistantModelFactsDto {
  @ApiProperty({ type: String, enum: ["model"] }) declare kind: "model";
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare format?: string | null;
}
export class AssistantPrinterFactsDto {
  @ApiProperty({ type: String, enum: ["printer"] }) declare kind: "printer";
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare brand?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare model?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare product_status?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare release_date?: string | null;
  @ApiPropertyOptional({ type: AssistantEvidencePriceFactDto, nullable: true }) declare price_ru_rub?: AssistantEvidencePriceFactDto | null;
  @ApiPropertyOptional({ type: AssistantEvidencePriceFactDto, nullable: true }) declare price_msrp_usd?: AssistantEvidencePriceFactDto | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare print_type?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare kinematics?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare enclosed?: boolean | null;
  @ApiPropertyOptional({ type: AssistantPrinterBuildVolumeDto, nullable: true }) declare build_volume_mm?: AssistantPrinterBuildVolumeDto | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare max_hotend_temperature_c?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare max_bed_temperature_c?: number | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare nozzle_material?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare nozzle_hardened?: boolean | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare nozzle_replaceable?: boolean | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare multimaterial_supported?: boolean | null;
  @ApiPropertyOptional({ type: [String], maxItems: ASSISTANT_EVIDENCE_LIMITS.factItems }) declare supported_materials?: readonly string[];
  @ApiPropertyOptional({ type: [String], maxItems: ASSISTANT_EVIDENCE_LIMITS.factItems }) declare unique_features?: readonly string[];
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare support_level?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare public_firmware_ready?: boolean | null;
}
export class AssistantMachineFactsDto {
  @ApiProperty({ type: String, enum: ["machine"] }) declare kind: "machine";
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare brand?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare model?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare active?: boolean | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare nozzle_material?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare nozzle_diameter_mm?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare enclosed?: boolean | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare direct_drive?: boolean | null;
}
export class AssistantUserPrinterFactsDto {
  @ApiProperty({ type: String, enum: ["user_printer"] }) declare kind: "user_printer";
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare display_name?: string | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare primary?: boolean | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare catalog_printer_id?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare machine_id?: string | null;
}
export class AssistantMaterialFactsDto {
  @ApiProperty({ type: String, enum: ["material"] }) declare kind: "material";
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare brand?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare name?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare material_type?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare color?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) declare diameter_mm?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) declare abrasive?: boolean | null;
  @ApiPropertyOptional({ type: AssistantEvidencePriceFactDto, nullable: true }) declare price_ru_rub?: AssistantEvidencePriceFactDto | null;
}
export class AssistantNewsFactsDto {
  @ApiProperty({ type: String, enum: ["news"] }) declare kind: "news";
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare effective_published_at?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text, nullable: true }) declare topic?: string | null;
}

export class AssistantComparisonCellDto {
  @ApiProperty({ type: String, enum: ["equal", "different", "missing", "stale"] }) declare state: "equal" | "different" | "missing" | "stale";
  @ApiProperty({ oneOf: [{ type: "string", maxLength: 300 }, { type: "number" }, { type: "boolean" }], nullable: true }) declare normalized_value: string | number | boolean | null;
  @ApiProperty({ type: String, maxLength: 300, nullable: true }) declare display_value: string | null;
  @ApiProperty({ type: String, enum: ["RUB", "USD", "mm", "C"], nullable: true }) declare unit: "RUB" | "USD" | "mm" | "C" | null;
  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true }) declare price_updated_at?: string | null;
  @ApiPropertyOptional({ type: String, enum: ASSISTANT_EVIDENCE_FRESHNESS_VALUES }) declare freshness?: (typeof ASSISTANT_EVIDENCE_FRESHNESS_VALUES)[number];
  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true }) declare freshness_reason?: string | null;
}
export class AssistantComparisonRowDto {
  @ApiProperty({ type: String, enum: ASSISTANT_COMPARISON_FIELDS }) declare field: (typeof ASSISTANT_COMPARISON_FIELDS)[number];
  @ApiProperty({ type: [AssistantComparisonCellDto], minItems: 2, maxItems: 4 }) declare cells: readonly AssistantComparisonCellDto[];
}
export class AssistantComparisonFactsDto {
  @ApiProperty({ type: String, enum: ["comparison"] }) declare kind: "comparison";
  @ApiProperty({ type: [String], minItems: 2, maxItems: 4, uniqueItems: true }) declare printer_ids: readonly string[];
  @ApiProperty({ type: [AssistantComparisonRowDto], minItems: 14, maxItems: 14 }) declare rows: readonly AssistantComparisonRowDto[];
}

const ASSISTANT_EVIDENCE_FACT_DTOS = [
  AssistantModelFactsDto,
  AssistantPrinterFactsDto,
  AssistantComparisonFactsDto,
  AssistantMachineFactsDto,
  AssistantUserPrinterFactsDto,
  AssistantMaterialFactsDto,
  AssistantNewsFactsDto,
] as const;

@ApiExtraModels(...ASSISTANT_EVIDENCE_FACT_DTOS)
export class AssistantEvidenceCitationDto {
  @ApiProperty({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text }) declare evidence_id: string;
  @ApiProperty({ type: String, enum: ASSISTANT_EVIDENCE_ENTITY_TYPES }) declare entity_type: (typeof ASSISTANT_EVIDENCE_ENTITY_TYPES)[number];
  @ApiProperty({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.text }) declare entity_id: string;
  @ApiProperty({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.title }) declare title: string;
  @ApiProperty({ type: String, maxLength: ASSISTANT_EVIDENCE_LIMITS.snippet }) declare snippet: string;
  @ApiProperty({ type: String, nullable: true, description: "Safe portal-relative path; no credentials, fragments or credential query keys." }) declare canonical_url: string | null;
  @ApiProperty({ oneOf: ASSISTANT_EVIDENCE_FACT_DTOS.map((type) => ({ $ref: getSchemaPath(type) })) }) declare facts:
    AssistantModelFactsDto | AssistantPrinterFactsDto | AssistantComparisonFactsDto | AssistantMachineFactsDto | AssistantUserPrinterFactsDto | AssistantMaterialFactsDto | AssistantNewsFactsDto;
  @ApiProperty({ type: [AssistantEvidenceSourceRefDto], maxItems: ASSISTANT_EVIDENCE_LIMITS.sourceRefs }) declare source_refs: readonly AssistantEvidenceSourceRefDto[];
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare source_published_at: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare observed_at: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare updated_at: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare price_updated_at: string | null;
  @ApiPropertyOptional({ type: String, enum: ASSISTANT_EVIDENCE_FRESHNESS_VALUES }) declare freshness?: (typeof ASSISTANT_EVIDENCE_FRESHNESS_VALUES)[number];
  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true }) declare freshness_reason?: string | null;
  @ApiProperty({ type: String, enum: ASSISTANT_EVIDENCE_QUALITY_VALUES }) declare quality: (typeof ASSISTANT_EVIDENCE_QUALITY_VALUES)[number];
  @ApiProperty({ type: [String], maxItems: ASSISTANT_EVIDENCE_LIMITS.missingFields }) declare missing_fields: readonly string[];
}

@ApiExtraModels(AssistantCitationDto, AssistantEvidenceCitationDto)
export class AssistantAnswerResultDto {
  @ApiProperty({ type: String, enum: ["answer"] }) declare kind: "answer";
  @ApiProperty({ type: String }) declare text: string;
  @ApiProperty({
    type: "array",
    items: { oneOf: [{ $ref: getSchemaPath(AssistantCitationDto) }, { $ref: getSchemaPath(AssistantEvidenceCitationDto) }] },
  })
  declare citations: readonly (AssistantCitationDto | AssistantEvidenceCitationDto)[];
  @ApiProperty({ type: String, nullable: true }) declare note: string | null;
}
export class AssistantClarificationResultDto {
  @ApiProperty({ type: String, enum: ["clarification"] }) declare kind: "clarification";
  @ApiProperty({ type: String }) declare question: string;
  @ApiProperty({ type: String, nullable: true }) declare reason: string | null;
}
export class AssistantGenerationOfferResultDto {
  @ApiProperty({ type: String, enum: ["generation_offer"] }) declare kind: "generation_offer";
  @ApiProperty({ type: String, format: "uuid" }) declare offer_id: string;
  @ApiProperty({ type: String, nullable: true }) declare branch: string | null;
  @ApiProperty({ type: String }) declare prompt_summary: string;
  @ApiProperty({ type: String, nullable: true }) declare note: string | null;
}
export class AssistantErrorResultDto {
  @ApiProperty({ type: String, enum: ["error"] }) declare kind: "error";
  @ApiProperty({ type: String, enum: ASSISTANT_ERROR_CODES }) declare code: AssistantErrorCode;
  @ApiProperty({ type: String }) declare message: string;
  @ApiProperty({ type: Boolean }) declare retryable: boolean;
}
export class AssistantRunDto {
  @ApiProperty({ type: String, format: "uuid" }) declare id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare thread_id: string;
  @ApiProperty({ type: String, format: "uuid" }) declare triggering_message_id: string;
  @ApiProperty({ type: String, enum: RUN_STATUSES }) declare status: RunStatus;
  @ApiProperty({ type: String, enum: RUN_RESULT_TYPES, nullable: true }) declare result_type: RunResultType | null;
  @ApiProperty({
    oneOf: [
      ...[AssistantAnswerResultDto, AssistantClarificationResultDto, AssistantGenerationOfferResultDto, AssistantErrorResultDto].map((type) => ({ $ref: getSchemaPath(type) })),
      { type: "object", additionalProperties: false, maxProperties: 0 },
    ],
  })
  declare result: AssistantAnswerResultDto | AssistantClarificationResultDto | AssistantGenerationOfferResultDto | AssistantErrorResultDto | { readonly kind?: never };
  @ApiProperty({ type: String, nullable: true }) declare error_code: string | null;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) declare confirmed_generation_id: string | null;
  @ApiProperty({ type: Number, nullable: true }) declare queue_position: number | null;
  @ApiProperty({ type: Number, nullable: true }) declare eta_seconds: number | null;
  @ApiProperty({ type: String, format: "date-time" }) declare created_at: Date;
  @ApiProperty({ type: String, format: "date-time" }) declare updated_at: Date;
}
export class AssistantMessagesResponseDto {
  @ApiProperty({ type: [AssistantMessageDto] }) declare items: readonly AssistantMessageDto[];
  @ApiProperty({ type: [AssistantRunDto] }) declare runs: readonly AssistantRunDto[];
  @ApiProperty({ type: String, nullable: true }) declare next_cursor: string | null;
}
export class AssistantRunResponseDto {
  @ApiProperty({ type: AssistantRunDto }) declare run: AssistantRunDto;
}
export class AssistantMessageCreatedResponseDto {
  @ApiProperty({ type: AssistantMessageDto }) declare message: AssistantMessageDto;
  @ApiProperty({ type: AssistantRunDto, nullable: true }) declare run: AssistantRunDto | null;
}

export class AssistantPromptIntentDto {
  @ApiProperty({ type: String }) declare normalized_query: string;
  @ApiProperty({ type: String, nullable: true }) declare motif: string | null;
}
export class AssistantPromptVariantDto {
  @ApiProperty({ type: String }) declare id: string;
  @ApiProperty({ type: String }) declare label: string;
  @ApiProperty({ type: String }) declare prompt: string;
  @ApiProperty({ type: String, nullable: true }) declare motif: string | null;
  @ApiProperty({ type: Number }) declare confidence: number;
}
export class AssistantCatalogMatchDto {
  @ApiProperty({ type: String, format: "uuid" }) declare model_id: string;
  @ApiProperty({ type: String }) declare title: string;
  @ApiProperty({ type: Number }) declare relevance_rank: number;
}
export class AssistantPromptVariantsResponseDto {
  @ApiProperty({ type: String, enum: ["assistant.prompt-variants.v1"] }) declare contract_version: "assistant.prompt-variants.v1";
  @ApiProperty({ type: String, format: "uuid" }) declare request_id: string;
  @ApiProperty({ type: AssistantPromptIntentDto }) declare intent: AssistantPromptIntentDto;
  @ApiProperty({ type: [AssistantPromptVariantDto] }) declare variants: readonly AssistantPromptVariantDto[];
  @ApiProperty({ type: [AssistantCatalogMatchDto] }) declare catalog_matches: readonly AssistantCatalogMatchDto[];
  @ApiPropertyOptional({ type: Boolean, enum: [true] }) declare degraded?: true;
}

export class AssistantThreadSnapshotEventDto {
  @ApiProperty({ type: String, format: "uuid" }) declare thread_id: string;
  @ApiProperty({ type: String, enum: ["chat", "device_incident"] }) declare kind: "chat" | "device_incident";
  @ApiProperty({ type: String, enum: ["info", "warning", "critical"], nullable: true }) declare severity: "info" | "warning" | "critical" | null;
  @ApiProperty({ type: String, enum: ["open", "acknowledged", "resolved"], nullable: true }) declare incident_status: "open" | "acknowledged" | "resolved" | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) declare read_at: Date | null;
}
export class AssistantRunSnapshotEventDto {
  @ApiProperty({ type: AssistantRunDto }) declare run: AssistantRunDto;
}
export class AssistantCompletedEventDto {
  @ApiProperty({ type: String, enum: ["done"] }) declare status: "done";
}
export class AssistantErrorEventDto {
  @ApiProperty({ type: String, nullable: true }) declare error_code: string | null;
}
export class AssistantIncidentEventDto {
  @ApiProperty({ type: String, format: "uuid" }) declare incident_id: string;
  @ApiProperty({ type: String, enum: ["acknowledged", "resolved"] }) declare status: "acknowledged" | "resolved";
}
