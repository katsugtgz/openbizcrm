/**
 * In-memory session store for dev (AUTH_FAKE=1) and tests. No WorkOS, no
 * cookies — a module-level variable is the whole implementation. The only
 * adapter besides AuthKit that genuinely varies (per design: pure engines
 * share one interface, only session storage has a seam).
 */
import type { AuthSession, SessionUser } from "./types";

let current: SessionUser | null = null;

/** Test/dev fixture: set (or clear with null) the fake session directly. */
export function setFakeUser(user: SessionUser | null): void {
  current = user;
}

export const SessionFake: AuthSession = {
  async getSession() {
    return current;
  },
  async signOut() {
    current = null;
  },
};
