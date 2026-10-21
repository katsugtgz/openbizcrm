import { OrgScopeError } from "./org-scope";

/**
 * Typed user-facing validation error: static message, safe to reflect in
 * `?error=` redirect URLs. Throw this (not plain Error) for input problems
 * the user can act on.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Safe message for ?error= in redirect URLs: ONLY static ValidationError
 * text is reflected (a type whitelist, not a length cap). PG driver
 * errors (constraint detail + values), OrgScopeError, and all other
 * dynamic errors map to the generic fallback so they never land in
 * browser history, logs, or the Referer header.
 */
export function safeRedirectError(error: unknown, fallback: string): string {
  if (error instanceof OrgScopeError) return "Akses ditolak.";
  if (error instanceof ValidationError) return error.message;
  return fallback;
}
