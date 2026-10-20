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

/** Resolve a cookie value to a session; null when missing or not allowlisted. */
function fromCookieValue(value: string | undefined): SessionUser | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep <= 0) return null;
  const seeded = FAKE_USERS[value.slice(0, sep) as FakeUserId];
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
