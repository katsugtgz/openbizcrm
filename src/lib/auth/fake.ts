/**
 * Fake session store for dev (AUTH_FAKE=1) and tests. No WorkOS: identity is
 * a per-browser cookie carrying an allowlisted seed user id plus a random
 * per-sign-in session id. Reads re-resolve identity from FAKE_USERS, so a
 * forged cookie cannot invent attributes. A module-level fallback keeps unit
 * tests working outside a request scope, where next/headers is unavailable.
 */
import type { AuthSession, SessionUser } from "./types";
import { FAKE_USERS, type FakeUserId } from "./fake-users";

/** Cookie holding the dev fake session (`<seed-id>:<session-id>`). */
export const FAKE_SESSION_COOKIE = "ob_fake_session";

/** Test fixture store: read only outside a request scope (unit tests). */
let current: SessionUser | null = null;

/** Test fixture: set (or clear with null) the fallback session directly. */
export function setFakeUser(user: SessionUser | null): void {
  current = user;
}

/**
 * Resolve a cookie value to a session; null when missing or not
 * allowlisted. Exported for unit tests.
 */
export function fromCookieValue(value: string | undefined): SessionUser | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep <= 0) return null;
  const id = value.slice(0, sep);
  // Own-property check (cubic pr10 fake:43): FAKE_USERS["toString"] is a
  // truthy inherited Function — spreading it builds a garbage "session"
  // that crashes every layout awaiting a real id/email.
  if (!Object.prototype.hasOwnProperty.call(FAKE_USERS, id)) return null;
  const seeded = FAKE_USERS[id as FakeUserId];
  const sessionId = value.slice(sep + 1);
  if (!seeded || !sessionId) return null;
  return { ...seeded, sessionId };
}

/**
 * Per-request session via next/headers, imported lazily (same reason the
 * AuthKit adapter loads lazily: keep server-only graphs out of unit tests).
 * Returns "unavailable" outside a request scope so tests use the fixture.
 */
async function readRequestSession(): Promise<
  SessionUser | null | "unavailable"
> {
  // Cookie reads are gated on explicit AUTH_FAKE=1 (cubic pr10 fake:51):
  // SessionFake also serves unconfigured-WorkOS envs so the login page can
  // render — without this gate anyone there could forge the cookie and
  // impersonate a seed user. (The test fixture below stays ungated: it is
  // in-memory, settable only by test code, never remotely.)
  if (process.env.AUTH_FAKE !== "1") return null;
  try {
    const { cookies } = await import("next/headers");
    return fromCookieValue((await cookies()).get(FAKE_SESSION_COOKIE)?.value);
  } catch {
    return "unavailable";
  }
}

export const SessionFake: AuthSession = {
  async getSession() {
    const viaCookie = await readRequestSession();
    if (viaCookie !== "unavailable") return viaCookie;
    return current;
  },
  async signOut() {
    current = null;
    try {
      const { cookies } = await import("next/headers");
      (await cookies()).delete(FAKE_SESSION_COOKIE);
    } catch {
      // Outside a request scope there is no cookie to clear.
    }
  },
};
