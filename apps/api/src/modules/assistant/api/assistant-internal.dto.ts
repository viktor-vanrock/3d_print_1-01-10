import { IsObject } from "class-validator";

/** Only arguments cross this boundary; identity and authority come from the run. */
export class AssistantToolCallDto {
  @IsObject()
  declare args: Record<string, unknown>;
}
