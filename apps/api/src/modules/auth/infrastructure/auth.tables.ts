import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const authTables = {
  owns: ["auth_pending_registrations", "email_otp", "user_identities", "users"],
  readsForeignViews: [],
} as const satisfies DomainTableManifest;
