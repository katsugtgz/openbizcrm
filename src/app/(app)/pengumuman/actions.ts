"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { createAnnouncement } from "@/lib/review/service";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return { user, ...ids };
}

export async function createAnnouncementAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  try {
    if (!title || !body)
      throw new Error("Judul dan isi pengumuman wajib diisi.");
    await createAnnouncement(userId, orgId, { title, body });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Gagal.",
    };
  }
  revalidatePath("/pengumuman");
  return { ok: true };
}
