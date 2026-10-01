import { isValidUsername } from "../../modules/profile/domain/profile.ts";

export const DEFAULT_NEST_PORT = 3002;
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const MIN_DEVELOPMENT_ADMIN_PASSWORD_LENGTH = 8;

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigurationError";
  }
}

export interface AdminBootstrapConfig {
  readonly username: string;
  readonly password: string;
}

// Источник правды по разрешённым CORS-origin (MF-636): CORS_ALLOWED_ORIGINS, иначе WEB_APP_URL,
// иначе прод-домен. Использует Nest bootstrap для production-allowlist (в dev CORS открыт).
const PROD_DEFAULT_ORIGIN = "https://3mf.tech";

export function getAllowedOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? process.env.WEB_APP_URL ?? PROD_DEFAULT_ORIGIN)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function resolveNestPort(value: string | undefined): number {
  if (value === undefined || value === "") return DEFAULT_NEST_PORT;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RuntimeConfigurationError("PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function resolveAdminBootstrapConfig(environment: Record<string, unknown>): AdminBootstrapConfig | null {
  const usernameValue = environment.ADMIN_USERNAME;
  const passwordValue = environment.ADMIN_PASSWORD;
  const username = typeof usernameValue === "string" ? usernameValue : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";

  // Чтение конфигурации bootstrap-владельца, не проверка доступа
  // eslint-disable-next-line no-restricted-syntax
  if (username === "" && password === "") {
    if (environment.NODE_ENV === "production") throw new RuntimeConfigurationError("ADMIN_USERNAME and ADMIN_PASSWORD are required in production");
    return null;
  }
  // Чтение конфигурации bootstrap-владельца, не проверка доступа
  // eslint-disable-next-line no-restricted-syntax
  if (username === "" || password === "") throw new RuntimeConfigurationError("ADMIN_USERNAME and ADMIN_PASSWORD must be configured together");
  if (username !== username.trim().toLowerCase() || username.length < 3 || !isValidUsername(username)) {
    throw new RuntimeConfigurationError("ADMIN_USERNAME must be a lowercase username containing 3-32 letters, digits, or dots");
  }
  const minPasswordLength = environment.NODE_ENV === "development" ? MIN_DEVELOPMENT_ADMIN_PASSWORD_LENGTH : MIN_ADMIN_PASSWORD_LENGTH;
  if (password.length < minPasswordLength) {
    throw new RuntimeConfigurationError(`ADMIN_PASSWORD must contain at least ${minPasswordLength} characters`);
  }
  if (password.length > 1024) throw new RuntimeConfigurationError("ADMIN_PASSWORD must contain at most 1024 characters");

  return { username, password };
}

export function validateRuntimeEnvironment(environment: Record<string, unknown>): Record<string, unknown> {
  const rawPort = environment.PORT;
  if (rawPort !== undefined && typeof rawPort !== "string") {
    throw new RuntimeConfigurationError("PORT must be provided as a string environment variable");
  }

  const admin = resolveAdminBootstrapConfig(environment);
  const relayControlBaseUrl = environment.RELAY_INTERNAL_BASE_URL;
  if (environment.NODE_ENV === "production" && (typeof relayControlBaseUrl !== "string" || relayControlBaseUrl.trim() === "")) {
    throw new RuntimeConfigurationError("RELAY_INTERNAL_BASE_URL is required in production");
  }
  if (typeof relayControlBaseUrl === "string" && relayControlBaseUrl.trim() !== "") {
    let parsed: URL;
    try {
      parsed = new URL(relayControlBaseUrl);
    } catch {
      throw new RuntimeConfigurationError("RELAY_INTERNAL_BASE_URL must be an absolute HTTP(S) URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new RuntimeConfigurationError("RELAY_INTERNAL_BASE_URL must use HTTP or HTTPS");
  }
  if (environment.NODE_ENV === "production") {
    const required = ["DATABASE_URL", "JWT_SECRET", "AUTH_HMAC_KEY", "AUTH_ENCRYPTION_KEY", "GIGA_HTTP_URL"] as const;
    const missing = required.filter((name) => typeof environment[name] !== "string" || environment[name].trim() === "");
    if (missing.length > 0) throw new RuntimeConfigurationError(`Missing required API environment variables: ${missing.join(", ")}`);
    const encryptionKey = environment.AUTH_ENCRYPTION_KEY;
    if (typeof encryptionKey !== "string" || Buffer.from(encryptionKey, "base64").length !== 32) {
      throw new RuntimeConfigurationError("AUTH_ENCRYPTION_KEY must contain 32 bytes encoded as base64");
    }
  }
  return {
    ...environment,
    PORT: resolveNestPort(rawPort),
    ...(admin === null
      ? {}
      : {
          ADMIN_USERNAME: admin.username,
        }),
  };
}

export function runtimeIntegrationWarnings(environment: Record<string, unknown>): string[] {
  if (environment.NODE_ENV !== "production") return [];
  const warnings: string[] = [];
  const serviceToken = environment.ASSISTANT_SERVICE_TOKEN;
  if (typeof serviceToken !== "string" || serviceToken.length < 32 || serviceToken.length > 512 || serviceToken.trim() === "") {
    warnings.push("assistant internal gateway unavailable: ASSISTANT_SERVICE_TOKEN is missing or invalid (expected 32-512 characters)");
  }
  const missingS3 = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"].filter((name) => typeof environment[name] !== "string" || environment[name].trim() === "");
  if (missingS3.length > 0) warnings.push(`S3 storage unavailable: missing ${missingS3.join(", ")}`);
  return warnings;
}
