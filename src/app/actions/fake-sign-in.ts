"use server";

import { redirect } from "next/navigation";
import { setFakeUser } from "@/lib/auth/fake";

/**
 * Dev-only sign-in (AUTH_FAKE=1): seeds the in-memory SessionFake with a
 * chosen seeded user, then enters the app. Guarded — a no-op entry point in
 * any other mode.
 */
export async function fakeSignInAction(formData: FormData): Promise<void> {
  if (process.env.AUTH_FAKE !== "1") redirect("/login");

  const id = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");
  if (!id || !email) redirect("/login");

  setFakeUser({
    id,
    email,
    firstName: name || null,
    lastName: null,
    sessionId: "fake-session",
  });
  redirect("/dashboard");
}
