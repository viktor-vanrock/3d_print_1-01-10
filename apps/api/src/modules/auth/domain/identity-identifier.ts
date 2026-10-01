import type { UserId } from "../../_kernel/brandedIds.ts";
import { EMAIL_DOMAINS, type EmailDomain } from "./auth.ts";

export const AUTH_IDENTITY_LOOKUP_PORT = Symbol("AUTH_IDENTITY_LOOKUP_PORT");
export const AUTH_IDENTITY_READ_PORT = Symbol("AUTH_IDENTITY_READ_PORT");
export type AuthIdentityProvider = "email_corp" | "plag_id";

export type AuthIdentityLookupResult =
  | { readonly kind: "invalid" }
  | { readonly kind: "not_found" }
  | { readonly kind: "found"; readonly userId: UserId };

export interface AuthIdentityLookupPort {
  findUserByExactIdentity(input: {
    readonly provider: AuthIdentityProvider;
    readonly identifier: string;
  }): Promise<AuthIdentityLookupResult>;
}

export interface AuthIdentityReadPort {
  hasVerifiedIdentity(userId: UserId): Promise<boolean>;
}

const LOCAL_PART_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PLAG_ID_RE = /^\d{1,20}$/;

function isEmailDomain(value: string): value is EmailDomain {
  return EMAIL_DOMAINS.some((domain) => domain === value);
}

export function normalizeIdentityIdentifier(provider: AuthIdentityProvider, value: string): string | null {
  const trimmed = value.trim();
  if (provider === "plag_id") return PLAG_ID_RE.test(trimmed) ? trimmed : null;

  const parts = trimmed.split("@");
  if (parts.length !== 2) return null;
  const localPart = parts[0]?.toLowerCase() ?? "";
  const domain = parts[1]?.toLowerCase() ?? "";
  if (!LOCAL_PART_RE.test(localPart)) return null;
  if (!isEmailDomain(domain)) return null;
  return `${localPart}@${domain}`;
}
