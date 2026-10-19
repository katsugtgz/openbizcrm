/**
 * WorkOS readiness predicate — single source of truth shared by src/proxy.ts
 * and the login page so the two checks cannot drift. Side-effect free (no
 * authkit import) so both server components and the proxy can use it.
 * Cookie password must be at least 32 chars and the redirect URI set
 * (cubic P2 middleware:18 / login:21 — partial config used to pass).
 */
export function isWorkosConfigured(): boolean {
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD ?? "";
  return (
    process.env.AUTH_FAKE !== "1" &&
    !!process.env.WORKOS_API_KEY &&
    !!process.env.WORKOS_CLIENT_ID &&
    cookiePassword.length >= 32 &&
    !!process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
  );
}
