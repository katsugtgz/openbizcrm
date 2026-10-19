/**
 * Session module entry point. Consumers import { session } from here —
 * never the adapters directly. AuthKit loads lazily: its module graph pulls
 * "server-only" and the WorkOS SDK, which must not load under AUTH_FAKE=1
 * (dev without WorkOS, jsdom tests).
 */
import { SessionFake } from "./fake";
import type { AuthSession } from "./types";

export type { AuthSession, SessionUser } from "./types";

let adapter: Promise<AuthSession> | null = null;

/**
 * Adapter selection matrix (pick order matters):
 * 1. Production (NODE_ENV=production) → AuthKit, always. The fake session is
 *    hard-disabled regardless of AUTH_FAKE or missing config (impersonation).
 * 2. AUTH_FAKE=1 → SessionFake (dev/tests without WorkOS).
 * 3. WorkOS unconfigured (missing API key / client ID / cookie password)
 *    → SessionFake, so the login page's "belum dikonfigurasi" fallback can
 *    render instead of AuthKit throwing.
 * 4. Otherwise → AuthKit (real WorkOS).
 */
function pick(): Promise<AuthSession> {
  adapter ??= allowFake()
    ? Promise.resolve(SessionFake)
    : import("./authkit").then(({ AuthKitSession }) => AuthKitSession);
  return adapter;
}

/**
 * Fake adapter is ever selectable only outside production: explicit
 * AUTH_FAKE=1, or WorkOS left unconfigured (so the login page's
 * "belum dikonfigurasi" guidance renders instead of AuthKit throwing).
 * Production builds never serve the fake session regardless of env.
 */
function allowFake(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    process.env.AUTH_FAKE === "1" ||
    !(
      !!process.env.WORKOS_API_KEY &&
      !!process.env.WORKOS_CLIENT_ID &&
      !!process.env.WORKOS_COOKIE_PASSWORD
    )
  );
}

/**
 * Whether the fake adapter is (or would be) selected. resolveSessionIds uses
 * this to keep auto-provisioning AuthKit-only: fake mode resolves strictly
 * from seeded rows.
 */
export function fakeSessionActive(): boolean {
  return allowFake();
}

export const session: AuthSession = {
  getSession: () => pick().then((a) => a.getSession()),
  signOut: () => pick().then((a) => a.signOut()),
};
