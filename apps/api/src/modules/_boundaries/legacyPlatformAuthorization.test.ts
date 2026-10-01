import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB_SRC = path.resolve(API_SRC, "../../web/src");

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

describe("legacy platform authorization", () => {
  it("forbids researcher role and legacy staff runtime authorization paths", () => {
    const violations = [...sourceFiles(API_SRC), ...sourceFiles(WEB_SRC)].flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const reasons = [
        /\b(?:user\??\.)?role\s*(?:===|!==)\s*["']researcher["']/.test(source) ? "researcher role gate" : null,
        /\bisStaff\b|\bis_staff\b/.test(source) ? "legacy staff reference" : null,
      ].filter((reason): reason is string => reason !== null);
      return reasons.map((reason) => `${path.relative(path.resolve(API_SRC, "../../../.."), file)}: ${reason}`);
    });
    expect(violations).toEqual([]);
  });
});
