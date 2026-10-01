// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { API_URL } from "@shared/api";
import { safeGitverseUrl, safeHttpsUrl, safeImageUrl } from "./safe-url.ts";

describe("safe URL boundaries", () => {
  it("accepts canonical HTTPS and GitVerse URLs", () => {
    expect(safeHttpsUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(safeGitverseUrl("https://gitverse.ru/team/repo")).toBe(
      "https://gitverse.ru/team/repo",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "http://example.com",
    "https://user:pass@example.com",
    "https://[invalid",
  ])("rejects unsafe external URL %s", (value) =>
    expect(safeHttpsUrl(value)).toBeNull(),
  );

  it("compares the GitVerse host exactly", () => {
    expect(safeGitverseUrl("https://evil.example/gitverse.ru/repo")).toBeNull();
  });

  it("accepts HTTPS images and rejects active or cleartext schemes", () => {
    expect(safeImageUrl("https://cdn.example.com/model.webp")).toBe(
      "https://cdn.example.com/model.webp",
    );
    expect(safeImageUrl("/assets/model.webp")).toBe(
      API_URL.startsWith("https:") ? `${API_URL}/assets/model.webp` : null,
    );
    expect(safeImageUrl("http://cdn.example.com/model.webp")).toBeNull();
    expect(safeImageUrl("//attacker.example/image.webp")).toBeNull();
    expect(safeImageUrl("blob:https://example.com/id")).toBeNull();
    expect(safeImageUrl("data:image/svg+xml,<svg/>")).toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
  });
});
