import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { RESEARCH_API_KEY_PREFIX } from "../src/modules/publicapi/public/operations.ts";
import { validateResearcherApiKey } from "./researcher-api-key.ts";

describe("researcher API key validation", () => {
  it("accepts a canonical base64url suffix containing 256 bits", () => {
    const key = `${RESEARCH_API_KEY_PREFIX}${randomBytes(16).toString("base64url")}.${randomBytes(32).toString("base64url")}`;

    expect(validateResearcherApiKey(key)).toBe(key);
  });

  it.each([
    ["missing value", undefined],
    ["short secret", `${RESEARCH_API_KEY_PREFIX}${randomBytes(16).toString("base64url")}.${randomBytes(16).toString("base64url")}`],
    ["padding", `${RESEARCH_API_KEY_PREFIX}${randomBytes(16).toString("base64url")}.${randomBytes(32).toString("base64url")}=`],
    ["noncanonical bits", `${RESEARCH_API_KEY_PREFIX}${"A".repeat(22)}.${"A".repeat(42)}B`],
    ["wrong prefix", `mf_pub_${randomBytes(32).toString("base64url")}`],
    ["short suffix", `${RESEARCH_API_KEY_PREFIX}${randomBytes(16).toString("base64url")}`],
    ["empty suffix", RESEARCH_API_KEY_PREFIX],
    ["base64 padding", `${RESEARCH_API_KEY_PREFIX}${randomBytes(32).toString("base64url")}=`],
    ["non-base64url characters", `${RESEARCH_API_KEY_PREFIX}${"a".repeat(42)}+`],
  ])("rejects %s", (_case, value) => {
    expect(() => validateResearcherApiKey(value)).toThrow("RESEARCHER_API_KEY");
  });
});
