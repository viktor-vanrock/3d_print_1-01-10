import { createHmac, timingSafeEqual } from "node:crypto";

const DEVELOPMENT_SECRET = "development-only-admin-audit-cursor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ADMIN_AUDIT_CURSOR_TTL_SECONDS = 15 * 60;

export interface AdminAuditFilter {
  readonly actorId: string;
  readonly action: string | null;
  readonly targetType: string | null;
  readonly actorFilter: string | null;
  readonly targetFilter: string | null;
  readonly from: string;
  readonly to: string;
  readonly limit: number;
}

export interface AdminAuditPosition { readonly createdAt: string; readonly id: string }
export interface AdminAuditCursorValue { readonly filter: AdminAuditFilter; readonly position: AdminAuditPosition }
export interface AdminAuditSuppliedFilters {
  readonly action?: string;
  readonly targetType?: string;
  readonly actorId?: string;
  readonly targetId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}
interface Options { readonly secret?: string; readonly now?: number; readonly ttlSeconds?: number }

export class AdminAuditCursorError extends Error {
  constructor() { super("invalid cursor"); this.name = "AdminAuditCursorError"; }
}

function secretFor(override?: string): string {
  if (override !== undefined) return override;
  const root = process.env.JWT_SECRET;
  if (root) return createHmac("sha256", root).update("admin-audit-cursor.v1").digest("base64url");
  if (process.env.NODE_ENV === "production") throw new AdminAuditCursorError();
  return DEVELOPMENT_SECRET;
}

function sign(body: string, secret: string): string { return createHmac("sha256", secret).update(body).digest("base64url"); }
function isObject(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validDate(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function nullableText(value: unknown): value is string | null { return value === null || typeof value === "string"; }

function parseFilter(value: unknown): AdminAuditFilter {
  if (!isObject(value) || typeof value.actorId !== "string" || !UUID_RE.test(value.actorId)
    || !nullableText(value.action) || !nullableText(value.targetType) || !nullableText(value.actorFilter)
    || !nullableText(value.targetFilter) || !validDate(value.from) || !validDate(value.to)
    || typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100) throw new AdminAuditCursorError();
  if (value.actorFilter !== null && !UUID_RE.test(value.actorFilter)) throw new AdminAuditCursorError();
  if (value.targetFilter !== null && !UUID_RE.test(value.targetFilter)) throw new AdminAuditCursorError();
  return { actorId: value.actorId, action: value.action, targetType: value.targetType, actorFilter: value.actorFilter, targetFilter: value.targetFilter, from: value.from, to: value.to, limit: value.limit };
}

function parsePosition(value: unknown): AdminAuditPosition {
  if (!isObject(value) || !validDate(value.createdAt) || typeof value.id !== "string" || !UUID_RE.test(value.id)) throw new AdminAuditCursorError();
  return { createdAt: value.createdAt, id: value.id };
}

export function encodeAdminAuditCursor(filter: AdminAuditFilter, position: AdminAuditPosition, options: Options = {}): string {
  const secret = secretFor(options.secret);
  const ttl = options.ttlSeconds ?? ADMIN_AUDIT_CURSOR_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new AdminAuditCursorError();
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: (options.now ?? Math.floor(Date.now() / 1000)) + ttl, filter, position }), "utf8").toString("base64url");
  return `aac1.${payload}.${sign(payload, secret)}`;
}

export function decodeAdminAuditCursor(raw: string, actorId: string, supplied: AdminAuditSuppliedFilters, options: Options = {}): AdminAuditCursorValue {
  const secret = secretFor(options.secret);
  const [version, body, providedSignature, extra] = raw.split(".");
  if (version !== "aac1" || !body || !providedSignature || extra !== undefined) throw new AdminAuditCursorError();
  const expected = Buffer.from(sign(body, secret), "ascii");
  const provided = Buffer.from(providedSignature, "ascii");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new AdminAuditCursorError();
  try {
    const decoded: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!isObject(decoded) || decoded.v !== 1 || typeof decoded.exp !== "number" || decoded.exp < (options.now ?? Math.floor(Date.now() / 1000))) throw new AdminAuditCursorError();
    const filter = parseFilter(decoded.filter);
    if (filter.actorId !== actorId) throw new AdminAuditCursorError();
    const comparisons: readonly (readonly [unknown, unknown])[] = [
      [supplied.action, filter.action], [supplied.targetType, filter.targetType], [supplied.actorId, filter.actorFilter],
      [supplied.targetId, filter.targetFilter], [supplied.from, filter.from], [supplied.to, filter.to], [supplied.limit, filter.limit],
    ];
    if (comparisons.some(([candidate, expectedValue]) => candidate !== undefined && candidate !== expectedValue)) throw new AdminAuditCursorError();
    return { filter, position: parsePosition(decoded.position) };
  } catch (error) {
    if (error instanceof AdminAuditCursorError) throw error;
    throw new AdminAuditCursorError();
  }
}
