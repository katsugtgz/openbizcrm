"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  addMaterial,
  completeCourse,
  createCourse,
} from "@/lib/review/service";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return { user, ...ids };
}

function fail(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Gagal.",
  };
}

export async function createCourseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  try {
    if (!title) throw new Error("Judul kursus wajib diisi.");
    const course = await createCourse(userId, orgId, {
      title,
      description: String(formData.get("description") ?? "").trim() || null,
    });
    const materialTitle = String(formData.get("materialTitle") ?? "").trim();
    const materialContent = String(
      formData.get("materialContent") ?? "",
    ).trim();
    if (materialTitle && materialContent) {
      await addMaterial(userId, orgId, {
        courseId: course.id,
        title: materialTitle,
        content: materialContent,
      });
    }
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/pelatihan");
  return { ok: true };
}

export async function addMaterialAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await addMaterial(userId, orgId, {
      courseId: String(formData.get("courseId") ?? ""),
      title: String(formData.get("title") ?? "").trim(),
      content: String(formData.get("content") ?? "").trim(),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/pelatihan");
  return { ok: true };
}

export async function completeCourseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await completeCourse(userId, orgId, String(formData.get("courseId") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/pelatihan");
  // /lms juga (cubic lms/page.tsx:56): tombol "Tandai Selesai" di /lms
  // harus hilang segera setelah sukses, tanpa navigasi manual.
  revalidatePath("/lms");
  return { ok: true, message: "Kursus ditandai selesai." };
}
