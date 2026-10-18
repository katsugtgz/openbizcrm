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

function pick(): Promise<AuthSession> {
  adapter ??=
    process.env.AUTH_FAKE === "1"
      ? Promise.resolve(SessionFake)
      : import("./authkit").then(({ AuthKitSession }) => AuthKitSession);
  return adapter;
}

export const session: AuthSession = {
  getSession: () => pick().then((a) => a.getSession()),
  signOut: () => pick().then((a) => a.signOut()),
};
