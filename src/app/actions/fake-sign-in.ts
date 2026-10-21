"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { FAKE_SESSION_COOKIE } from "@/lib/auth/fake";
import { FAKE_USERS, type FakeUserId } from "@/lib/auth/fake-users";

/**
 * Dev-only sign-in (AUTH_FAKE=1, non-production): mints a per-browser fake
 * session cookie for an allowlisted seeded user, then enters the app. The
 * form carries only `id`; the identity is resolved server-side from
 * FAKE_USERS — posted email/name are ignored so enabling AUTH_FAKE on a
 * reachable host cannot let a caller impersonate an arbitrary identity.
 */
export async function fakeSignInAction(formData: FormData): Promise<void> {
  if (process.env.AUTH_FAKE !== "1" || process.env.NODE_ENV === "production") {
    redirect("/login");
  }

  const id = String(formData.get("id") ?? "") as FakeUserId;
  const seeded = FAKE_USERS[id];
  if (!seeded) redirect("/login");

  // Per-browser cookie (httpOnly, session-lived): concurrent dev browsers no
  // longer share one process-global identity. The value carries only the
  // allowlisted seed id plus a random per-sign-in session id; reads
  // re-resolve identity from FAKE_USERS (see SessionFake).
  const sessionId = `fake-${randomUUID()}`;
  (await cookies()).set(FAKE_SESSION_COOKIE, `${id}:${sessionId}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/dashboard");
}
