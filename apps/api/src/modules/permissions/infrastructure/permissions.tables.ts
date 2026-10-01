import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const permissionsTables: DomainTableManifest = {
  owns: ["admin_permission_assignment_items", "admin_permission_assignments", "permission_change_confirmations", "permission_grants"],
  readsForeignViews: ["authorization_identity_read_v1", "identity_read_v1", "superadmin_identity_read_v1"],
};
