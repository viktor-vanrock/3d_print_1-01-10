import { API_URL } from "@shared/api";

function parsedHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "")
      return null;
    return url;
  } catch {
    return null;
  }
}

export function safeHttpsUrl(value: unknown): string | null {
  return parsedHttpsUrl(value)?.toString() ?? null;
}

export function safeGitverseUrl(value: unknown): string | null {
  const url = parsedHttpsUrl(value);
  return url !== null && url.hostname === "gitverse.ru" ? url.toString() : null;
}

export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.startsWith("//")) return null;
  try {
    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
    const path = value.startsWith("/") ? value : `/${value}`;
    const candidate = hasScheme ? value : `${API_URL}${path}`;
    const url = new URL(candidate, window.location.origin);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? candidate
      : null;
  } catch {
    return null;
  }
}
