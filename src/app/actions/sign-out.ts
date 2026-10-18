"use server";

import { redirect } from "next/navigation";
import { session } from "@/lib/auth";

/** Signs out through the session seam, then lands on the public page. */
export async function signOutAction(): Promise<void> {
  await session.signOut();
  redirect("/");
}
