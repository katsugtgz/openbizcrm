/**
 * Tiny, pure env helpers. No process access of their own beyond what callers
 * pass in — keeps them trivially unit-testable.
 */

/** Parse a string env value into a boolean with an explicit fallback. */
export function parseBoolean(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Read a required env var. Throws a clear error in production, warns (and
 * returns undefined) everywhere else so local/dev bootstrapping stays forgiving.
 */
export function requiredEnv(
  key: string,
  getValue: (key: string) => string | undefined = (k) => process.env[k],
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | undefined {
  const value = getValue(key);
  if (value !== undefined && value !== "") return value;

  const message =
    `Missing required environment variable: ${key}. ` +
    "Set it in your .env file or environment.";

  if (nodeEnv === "production") {
    throw new Error(message);
  }
  console.warn(`[env] ${message}`);
  return undefined;
}
