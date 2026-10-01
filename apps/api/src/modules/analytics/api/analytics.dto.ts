import { Transform } from "class-transformer";
import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { CONSENT_ACTIONS, type ConsentAction } from "../domain/analytics.ts";

export class RecordConsentDto {
  @ApiProperty({ enum: CONSENT_ACTIONS })
  @IsIn(CONSENT_ACTIONS)
  declare readonly action: ConsentAction;

  @ApiProperty({ type: String, maxLength: 50 })
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare readonly version: string;
}

export class ConsentRecordedDto {
  @ApiProperty({ enum: [true] }) declare readonly ok: true;
}
