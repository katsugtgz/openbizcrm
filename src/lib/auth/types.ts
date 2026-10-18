/**
 * The one session interface every consumer uses. Two implementations:
 * AuthKit (WorkOS, prod) and SessionFake (dev/tests without WorkOS).
 * Selected in src/lib/auth/index.ts.
 */
export interface SessionUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** AuthKit session id; fake uses a fixed value. */
  sessionId: string;
  /** Present when the user belongs to a WorkOS organization. */
  organizationId?: string;
}

export interface AuthSession {
  /** Current session, or null when signed out. */
  getSession(): Promise<SessionUser | null>;
  /** End the session (fake: clears memory; AuthKit: clears cookie + redirects). */
  signOut(): Promise<void>;
}
