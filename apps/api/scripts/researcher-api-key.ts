import { parseResearchApiKey } from "../src/modules/publicapi/public/operations.ts";

export function validateResearcherApiKey(value: unknown): string {
  const parsed = parseResearchApiKey(value);
  if (!parsed) throw new Error("RESEARCHER_API_KEY: ожидается mf_research_<16-byte-public-id>.<32-byte-secret>, canonical base64url без padding");
  return parsed.key;
}
