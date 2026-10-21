/**
 * WorkOS readiness predicates — single source of truth shared by src/proxy.ts,
 * the login page, and the session adapter picker so the checks cannot drift.
 * Side-effect free (no authkit import) so server components, the proxy, and
 * the picker can all use them. Cookie password must be at least 32 chars and
 * (for full readiness) the redirect URI set (cubic P2 middleware:18 /
 * login:21 — partial config used to pass).
 */

/**
 * Minimum WorkOS cookie password length (seal requirement). A short cookie
 * is a misconfiguration that fails closed through AuthKit — it must never
 * select the fake adapter (cubic pr10 auth-config:36).
 */
export const WORKOS_MIN_COOKIE_PASSWORD_LENGTH = 32;

export function isWorkosConfigured(): boolean {
  return (
    process.env.AUTH_FAKE !== "1" &&
    isWorkosSessionEnvReady() &&
    !!process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
  );
}

/**
 * Presence-only variant for the fake-fallback predicate: only a truly
 * absent WorkOS config falls back to fake outside production. Length is
 * deliberately NOT checked here (cubic pr10 auth-config:36).
 */
export function isWorkosEnvPresent(): boolean {
  return (
    !!process.env.WORKOS_API_KEY &&
    !!process.env.WORKOS_CLIENT_ID &&
    !!process.env.WORKOS_COOKIE_PASSWORD
  );
}

/**
 * Session-readiness: can AuthKit read a session without throwing? Presence
 * plus the seal length. Unlike isWorkosConfigured this omits AUTH_FAKE and
 * the redirect URI (only needed to mint sign-in URLs, not to read
 * sessions). Built on isWorkosEnvPresent so the key/client checks can't
 * drift (cubic pr10 r2:2258).
 */
export function isWorkosSessionEnvReady(): boolean {
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? "";
  return (
    isWorkosEnvPresent() &&
    cookiePassword.length >= WORKOS_MIN_COOKIE_PASSWORD_LENGTH
  );
}
