import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_USER_DIRECTORY_CURSOR_TTL_SECONDS = 15 * 60;
const DEVELOPMENT_CURSOR_SECRET = "development-only-admin-user-directory-cursor";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AdminUserStatus = "active" | "restricted" | "deleted";

export interface AdminUserDirectoryFilter {
  readonly mode: "browse" | "search";
  readonly status: AdminUserStatus | null;
  readonly query: string | null;
  readonly limit: number;
}

export interface AdminUserDirectoryPosition {
  readonly createdAt: string;
  readonly userId: string;
}

interface CursorOptions {
  readonly secret?: string;
  readonly now?: number;
  readonly ttlSeconds?: number;
}

export class AdminUserDirectoryCursorError extends Error {
  constructor() {
    super("invalid cursor");
    this.name = "AdminUserDirectoryCursorError";
  }
}

function secretFor(override?: string): string {
  if (override !== undefined) return override;
  const root = process.env.JWT_SECRET;
  if (root) return createHmac("sha256", root).update("admin-user-directory-cursor.v1").digest("base64url");
  if (process.env.NODE_ENV === "production") throw new AdminUserDirectoryCursorError();
  return DEVELOPMENT_CURSOR_SECRET;
}

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function encodeAdminUserDirectoryCursor(
  position: AdminUserDirectoryPosition,
  filter: AdminUserDirectoryFilter,
  options: CursorOptions = {},
): string {
  const secret = secretFor(options.secret);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? ADMIN_USER_DIRECTORY_CURSOR_TTL_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new AdminUserDirectoryCursorError();
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: now + ttl, fingerprint: fingerprintWithSecret(filter, secret), position }), "utf8").toString("base64url");
  return `auc1.${payload}.${signature(payload, secret)}`;
}

function fingerprintWithSecret(filter: AdminUserDirectoryFilter, secret: string): string {
  return createHmac("sha256", secret).update(JSON.stringify(filter)).digest("base64url");
}

export function decodeAdminUserDirectoryCursor(
  raw: string,
  filter: AdminUserDirectoryFilter,
  options: CursorOptions = {},
): AdminUserDirectoryPosition {
  const secret = secretFor(options.secret);
  const [version, body, suppliedSignature, extra] = raw.split(".");
  if (version !== "auc1" || !body || !suppliedSignature || extra !== undefined) throw new AdminUserDirectoryCursorError();
  const expectedSignature = signature(body, secret);
  const supplied = Buffer.from(suppliedSignature, "ascii");
  const expected = Buffer.from(expectedSignature, "ascii");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AdminUserDirectoryCursorError();
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AdminUserDirectoryCursorError();
    const parsed = value as { v?: unknown; exp?: unknown; fingerprint?: unknown; position?: unknown };
    const position = parsed.position;
    if (
      parsed.v !== 1 || typeof parsed.exp !== "number" || parsed.exp < (options.now ?? Math.floor(Date.now() / 1000))
      || parsed.fingerprint !== fingerprintWithSecret(filter, secret) || position === null || typeof position !== "object" || Array.isArray(position)
    ) throw new AdminUserDirectoryCursorError();
    const candidate = position as { createdAt?: unknown; userId?: unknown };
    if (typeof candidate.createdAt !== "string" || Number.isNaN(Date.parse(candidate.createdAt)) || typeof candidate.userId !== "string" || !UUID_RE.test(candidate.userId)) {
      throw new AdminUserDirectoryCursorError();
    }
    return { createdAt: candidate.createdAt, userId: candidate.userId };
  } catch (error) {
    if (error instanceof AdminUserDirectoryCursorError) throw error;
    throw new AdminUserDirectoryCursorError();
  }
}
