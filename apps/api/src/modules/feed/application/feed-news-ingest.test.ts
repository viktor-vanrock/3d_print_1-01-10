import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalizeFeedSourceUrl, parseScoutIngestCommand } from "./feed-news-ingest.ts";

const fixturesPath = new URL("../../../../../../packages/contracts/jobs/fixtures/feed-news.v1.json", import.meta.url);

describe("Scout News ingest contract", () => {
  it("accepts only a ready feed-news outcome and derives trusted host fields", async () => {
    const fixtures = JSON.parse(await readFile(fixturesPath, "utf8")) as { rich_article: unknown };
    const command = parseScoutIngestCommand(fixtures.rich_article);
    expect(command.kind).toBe("draft");
    if (command.kind !== "draft") return;
    expect(command.title.length).toBeGreaterThan(0);
    expect(command.sourceFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(command.communityHint).not.toBeNull();
  });

  it("accepts only an explicit UUID publish command", () => {
    expect(parseScoutIngestCommand({ action: "publish", post_id: "05cb13c8-5c36-4c37-804c-e1cdb2219e9f" })).toEqual({
      kind: "publish",
      postId: "05cb13c8-5c36-4c37-804c-e1cdb2219e9f",
    });
    expect(() => parseScoutIngestCommand({ action: "publish", post_id: "not-an-id" })).toThrow();
  });

  it("canonicalizes sources without credentials, tracking or fragments", () => {
    expect(canonicalizeFeedSourceUrl("https://Vendor.example:443/news/?utm_source=x&b=2&a=1#x")).toBe("https://vendor.example/news?a=1&b=2");
    expect(canonicalizeFeedSourceUrl("https://user:secret@example.test/news")).toBeNull();
  });
});
