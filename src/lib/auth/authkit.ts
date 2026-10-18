/**
 * AuthKit adapter (production). Thin mapping of @workos-inc/authkit-nextjs
 * primitives onto our SessionUser interface. Server-only: touches cookies
 * and WorkOS env vars. Typecheck-verified only (no live WorkOS creds here).
 */
import "server-only";

import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import type { NoUserInfo, UserInfo } from "@workos-inc/authkit-nextjs";
import type { AuthSession, SessionUser } from "./types";

function toSessionUser(info: UserInfo): SessionUser {
  return {
    id: info.user.id,
    email: info.user.email,
    firstName: info.user.firstName ?? null,
    lastName: info.user.lastName ?? null,
    sessionId: info.sessionId,
    organizationId: info.organizationId,
  };
}

export const AuthKitSession: AuthSession = {
  async getSession() {
    const info: UserInfo | NoUserInfo = await withAuth();
    return info.user ? toSessionUser(info as UserInfo) : null;
  },
  async signOut() {
    // AuthKit clears the sealed cookie and redirects; kept void for interface
    // parity — the redirect response is handled by authkit's internals.
    await signOut({ returnTo: "/" });
  },
};
