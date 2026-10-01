import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { isAssistantEvidenceTimestamp, isAssistantEvidenceUrl, type AssistantEvidenceCitation } from "@portal/contracts/http/assistant";
import { FeedPostId } from "../../_kernel/brandedIds.ts";
import type { AssistantNewsPeriod, AssistantNewsReadResult, FeedAssistantNewsPort } from "../public/index.ts";
import { FeedRepository, type AssistantNewsRow } from "../infrastructure/feed.repository.ts";

export const ASSISTANT_NEWS_DEFAULT_CALENDAR_DAYS = 30;
export const ASSISTANT_NEWS_MAX_CALENDAR_DAYS = 365;
export const ASSISTANT_NEWS_MAX_RESULTS = 10;

const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u;
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

interface NormalizedNewsRange {
  readonly from: Date;
  readonly to: Date;
  readonly period: AssistantNewsPeriod;
}

function utcDay(value: Date, offsetDays = 0): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + offsetDays));
}

function parseBoundary(value: string, end: boolean): Date {
  const date = CALENDAR_DATE.exec(value);
  if (date !== null) {
    const parsed = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]) + (end ? 1 : 0)));
    const expected = `${date[1]}-${date[2]}-${date[3]}`;
    if (utcDay(parsed, end ? -1 : 0).toISOString().slice(0, 10) !== expected) throw new UnprocessableEntityException("invalid news range date");
    return parsed;
  }
  if (!RFC3339_TIMESTAMP.test(value)) throw new UnprocessableEntityException("news range timestamps require an explicit timezone");
  if (!isAssistantEvidenceTimestamp(value)) throw new UnprocessableEntityException("invalid news range timestamp");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new UnprocessableEntityException("invalid news range timestamp");
  return parsed;
}

/** Ranges are [from, to) instants. Defaults are thirty complete UTC calendar dates, including today. */
export function normalizeAssistantNewsRange(input: { readonly from?: string; readonly to?: string }, now = new Date()): NormalizedNewsRange {
  if ((input.from === undefined) !== (input.to === undefined)) throw new UnprocessableEntityException("news range requires both from and to");
  if (input.from === undefined || input.to === undefined) {
    const to = utcDay(now, 1);
    const from = utcDay(now, 1 - ASSISTANT_NEWS_DEFAULT_CALENDAR_DAYS);
    return { from, to, period: { from: from.toISOString(), to: to.toISOString(), defaulted: true, bounded: false, date_basis: "portal_published_at" } };
  }
  const from = parseBoundary(input.from, false);
  const requestedTo = parseBoundary(input.to, true);
  if (requestedTo <= from) throw new UnprocessableEntityException("news range end must follow start");
  const maximumTo = new Date(from.getTime() + ASSISTANT_NEWS_MAX_CALENDAR_DAYS * 86_400_000);
  const bounded = requestedTo > maximumTo;
  const to = bounded ? maximumTo : requestedTo;
  return { from, to, period: { from: from.toISOString(), to: to.toISOString(), defaulted: false, bounded, date_basis: "portal_published_at" } };
}

function bounded(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length <= maximum ? value : `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}

function iso(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new BadRequestException("invalid portal news timestamp");
  return value.toISOString();
}

function evidence(row: AssistantNewsRow): AssistantEvidenceCitation | null {
  // Source date is not yet first-class; published_at records the portal's
  // publication event and may be used for period membership instead.
  if (row.published_at === null || !isAssistantEvidenceUrl(row.source_url)) return null;
  return {
    evidence_id: `news:${row.id}`,
    entity_type: "news",
    entity_id: row.id,
    title: bounded(row.title, 300),
    snippet: bounded(row.body?.trim() || row.title, 2_000),
    canonical_url: `/feed/p/${row.id}`,
    facts: { kind: "news", effective_published_at: iso(row.published_at), topic: null },
    source_refs: [{ label: "Original source", url: row.source_url }],
    source_published_at: null,
    observed_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    price_updated_at: null,
    freshness: "unknown",
    freshness_reason: "source_published_at_unavailable; portal publication date is shown separately",
    quality: "reported",
    missing_fields: ["source_published_at"],
  };
}

@Injectable()
export class AssistantNewsService implements FeedAssistantNewsPort {
  constructor(@Inject(FeedRepository) private readonly repository: FeedRepository) {}

  async listAssistantNews(input: { readonly from?: string; readonly to?: string; readonly topic?: string; readonly limit?: number }): Promise<AssistantNewsReadResult> {
    const limit = input.limit ?? ASSISTANT_NEWS_MAX_RESULTS;
    if (!Number.isInteger(limit) || limit < 1 || limit > ASSISTANT_NEWS_MAX_RESULTS) throw new UnprocessableEntityException("invalid news limit");
    const topic = input.topic?.trim();
    if (topic !== undefined && (topic.length === 0 || Array.from(topic).length > 120)) throw new UnprocessableEntityException("invalid news topic");
    const range = normalizeAssistantNewsRange(input);
    const rows = await this.repository.listAssistantNews({ from: range.from, to: range.to, ...(topic === undefined ? {} : { topic }), limit });
    return { period: range.period, evidence: rows.flatMap((row) => {
      const item = evidence(row);
      return item === null ? [] : [item];
    }) };
  }

  async isAssistantNewsVisible(postId: FeedPostId): Promise<boolean> {
    const row = await this.repository.assistantNewsById(postId);
    return row !== null && evidence(row) !== null;
  }
}
