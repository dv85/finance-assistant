import { env } from "cloudflare:workers";

export function getDb(): D1Database {
  if (!env.DB) throw new Error("Local D1 binding `DB` is unavailable.");
  return env.DB;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
