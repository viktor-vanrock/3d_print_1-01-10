import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SanctionResponseDto {
  @ApiProperty({ format: "uuid" })
  declare readonly id: string;

  @ApiProperty({ format: "uuid" })
  declare readonly userId: string;

  @ApiProperty()
  declare readonly type: string;

  @ApiProperty()
  declare readonly state: string;

  @ApiProperty()
  declare readonly reasonCode: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  declare readonly reasonNote: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  declare readonly evidenceUrl: string | null;

  @ApiProperty({ format: "date-time" })
  declare readonly startsAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date, format: "date-time" })
  declare readonly endsAt: Date | null;

  @ApiProperty({ format: "uuid" })
  declare readonly createdBy: string;

  @ApiPropertyOptional({ nullable: true, type: String, format: "uuid" })
  declare readonly cancelledBy: string | null;

  @ApiProperty({ format: "date-time" })
  declare readonly createdAt: Date;
}

export class SanctionAppealResponseDto {
  @ApiProperty({ format: "uuid" })
  declare readonly id: string;

  @ApiProperty({ format: "uuid" })
  declare readonly sanctionId: string;

  @ApiProperty({ format: "uuid" })
  declare readonly submittedBy: string;

  @ApiProperty()
  declare readonly message: string;

  @ApiProperty()
  declare readonly state: string;

  @ApiPropertyOptional({ nullable: true, type: String, format: "uuid" })
  declare readonly resolvedBy: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  declare readonly resolutionNote: string | null;
}
