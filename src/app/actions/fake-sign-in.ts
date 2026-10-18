"use server";

import { redirect } from "next/navigation";
import { setFakeUser } from "@/lib/auth/fake";
import { FAKE_USERS, type FakeUserId } from "@/lib/auth/fake-users";

/**
 * Dev-only sign-in (AUTH_FAKE=1, non-production): seeds the in-memory
 * SessionFake with an allowlisted seeded user, then enters the app. The form
 * carries only `id`; the identity is resolved server-side from FAKE_USERS —
 * posted email/name are ignored so enabling AUTH_FAKE on a reachable host
 * cannot let a caller impersonate an arbitrary identity.
 */
export async function fakeSignInAction(formData: FormData): Promise<void> {
  if (process.env.AUTH_FAKE !== "1" || process.env.NODE_ENV === "production") {
    redirect("/login");
  }

  const id = String(formData.get("id") ?? "") as FakeUserId;
  const seeded = FAKE_USERS[id];
  if (!seeded) redirect("/login");

  setFakeUser({ ...seeded, sessionId: "fake-session" });
  redirect("/dashboard");
}
