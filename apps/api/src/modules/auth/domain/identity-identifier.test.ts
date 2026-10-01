import { describe, expect, it } from "vitest";
import { normalizeIdentityIdentifier } from "./identity-identifier.ts";

describe("normalizeIdentityIdentifier", () => {
  it("reproduces the canonical email string persisted by corporate-email auth", () => {
    expect(normalizeIdentityIdentifier("email_corp", "  Person.Name@SBERBANK.RU  ")).toBe("person.name@sberbank.ru");
    expect(normalizeIdentityIdentifier("email_corp", "person.name@sberdevices.ru")).toBe("person.name@sberdevices.ru");
  });

  it("reproduces the decimal string persisted by PlagID auth without merging distinct strings", () => {
    expect(normalizeIdentityIdentifier("plag_id", " 123456789 ")).toBe("123456789");
    expect(normalizeIdentityIdentifier("plag_id", "00123456789")).toBe("00123456789");
  });

  it.each([
    ["email_corp", "person@example.org"],
    ["email_corp", "invalid"],
    ["plag_id", "-1"],
    ["plag_id", "12.5"],
    ["plag_id", ""],
  ] as const)("rejects an invalid %s identifier without returning a fingerprint", (provider, identifier) => {
    expect(normalizeIdentityIdentifier(provider, identifier)).toBeNull();
  });
});
