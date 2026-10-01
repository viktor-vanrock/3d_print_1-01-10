import { createHash } from "node:crypto";
import { UnprocessableEntityException } from "@nestjs/common";
import { isFeedNewsJobOutcome } from "@portal/contracts/jobs/feed-news";
import { FeedPostId } from "../../_kernel/brandedIds.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKING = new Set(["dclid", "fbclid", "gclid", "gbraid", "mc_cid", "mc_eid", "msclkid", "twclid", "wbraid", "yclid", "_hsenc", "_hsmi"]);

export interface NewsCommunityHint {
  readonly subjectType: "vendor" | "machine";
  readonly subjectId: string | null;
  readonly subjectSlug: string | null;
}

export type ScoutIngestCommand =
  | { readonly kind: "publish"; readonly postId: FeedPostId }
  | {
      readonly kind: "draft";
      readonly jobId: string;
      readonly title: string;
      readonly body: string;
      readonly sourceUrl: string;
      readonly sourceFingerprint: string;
      readonly provider: string;
      readonly model: string;
      readonly promptVersion: string;
      readonly communityHint: NewsCommunityHint;
    };

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalizeFeedSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") return null;
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || TRACKING.has(normalized)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function parseScoutIngestCommand(value: unknown): ScoutIngestCommand {
  if (record(value) && value.action === "publish") {
    if (typeof value.post_id !== "string" || !UUID_RE.test(value.post_id)) throw new UnprocessableEntityException("INVALID_POST_ID");
    return { kind: "publish", postId: FeedPostId(value.post_id) };
  }
  if (!isFeedNewsJobOutcome(value) || value.outcome !== "ready") throw new UnprocessableEntityException("INVALID_NEWS_OUTCOME");
  const article = value.normalized_news;
  const candidateHint = value.candidate.community_subject_hint;
  const articleHint = article.community_subject_hint;
  if (candidateHint === null || articleHint === null || (candidateHint.subject_type !== "vendor" && candidateHint.subject_type !== "machine") ||
    candidateHint.subject_type !== articleHint.subject_type || candidateHint.subject_id !== articleHint.subject_id ||
    candidateHint.subject_slug?.toLowerCase() !== articleHint.subject_slug?.toLowerCase()) {
    throw new UnprocessableEntityException("COMMUNITY_HINT_MISMATCH");
  }
  const source = article.source_records[0];
  const sourceUrl = source === undefined ? null : canonicalizeFeedSourceUrl(source.canonical_url);
  const title = article.title.trim();
  if (sourceUrl === null || title === "" || title.length > 300) throw new UnprocessableEntityException("INVALID_NEWS_OUTCOME");
  return {
    kind: "draft",
    jobId: value.job_id,
    title,
    body: article.body_markdown,
    sourceUrl,
    sourceFingerprint: `sha256:${createHash("sha256").update(sourceUrl).digest("hex")}`,
    provider: article.provenance.provider,
    model: article.provenance.model,
    promptVersion: article.provenance.prompt_version,
    communityHint: { subjectType: candidateHint.subject_type, subjectId: candidateHint.subject_id, subjectSlug: candidateHint.subject_slug },
  };
}
