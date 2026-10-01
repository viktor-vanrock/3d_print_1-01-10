import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Step 6 account and credential migration", () => {
  it("adds session registry, forces old JWT sign-in and protects rollback", async () => {
    const sql = await readFile(fileURLToPath(new URL("./20260924210000_admin_account_credentials.sql", import.meta.url)), "utf8");
    expect(sql).toContain("CREATE TABLE public.browser_sessions");
    expect(sql).toContain("session_version=session_version+1");
    expect(sql).toContain("refusing rollback: Step 6 state exists");
    expect(sql).not.toContain("admin.device_relay_close.v1");
  });
});
