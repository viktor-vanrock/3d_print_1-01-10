import { applyDecorators } from "@nestjs/common";
import { ApiCreatedResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ConsentRecordedDto } from "./analytics.dto.ts";

export function ApiConsentOperation(): MethodDecorator {
  return applyDecorators(ApiTags("analytics"), ApiOperation({ summary: "Record or revoke analytics consent" }), ApiCreatedResponse({ type: ConsentRecordedDto }));
}
