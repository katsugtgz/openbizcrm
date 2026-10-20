"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  addMaterial,
  assignReviewers,
  closeForm,
  closePeriod,
  completeCourse,
  createAnnouncement,
  createCourse,
  createForm,
  createPeriod,
  publishForm,
  submitResponse,
  updateForm,
} from "@/lib/review/service";
import type { ReviewFormField } from "@/db/schema";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Auth boundary: WorkOS session IDs -> internal UUIDs (pola crm/actions.ts). */
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

/** Definisi field dikirim sebagai JSON string dari form (dinamis). */
function parseFieldsJson(raw: string): ReviewFormField[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (f): f is ReviewFormField =>
        typeof f === "object" &&
        f !== null &&
        typeof (f as ReviewFormField).key === "string" &&
        typeof (f as ReviewFormField).type === "string",
    );
  } catch {
    return null;
  }
}

// ---------------- Forms ----------------

export async function createFormAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  try {
    if (!title) throw new Error("Judul form wajib diisi.");
    const fields = parseFieldsJson(String(formData.get("fields") ?? "[]"));
    if (!fields) throw new Error("Definisi field tidak valid.");
    await createForm(userId, orgId, { title, description, fields });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true };
}

export async function updateFormAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const id = String(formData.get("id") ?? "");
  try {
    const fields = parseFieldsJson(String(formData.get("fields") ?? "[]"));
    if (!fields) throw new Error("Definisi field tidak valid.");
    await updateForm(userId, orgId, id, {
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      fields,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true };
}

export async function publishFormAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await publishForm(userId, orgId, String(formData.get("id") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true, message: "Form dipublish." };
}

export async function closeFormAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await closeForm(userId, orgId, String(formData.get("id") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true, message: "Form ditutup." };
}

// ---------------- Periods + assignments + responses ----------------

export async function createPeriodAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await createPeriod(userId, orgId, {
      formId: String(formData.get("formId") ?? ""),
      title: String(formData.get("title") ?? "").trim(),
      startDate: String(formData.get("startDate") ?? "").trim() || null,
      endDate: String(formData.get("endDate") ?? "").trim() || null,
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true };
}

/**
 * Auto-assign 360: pasangan dikirim sebagai JSON
 * [{revieweeUserId, reviewerUserId, relation}].
 */
export async function assignReviewersAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    const periodId = String(formData.get("periodId") ?? "");
    const pairs = JSON.parse(
      String(formData.get("pairs") ?? "[]"),
    ) as Parameters<typeof assignReviewers>[3];
    await assignReviewers(userId, orgId, periodId, pairs);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true, message: "Assignment dibuat." };
}

/** Jawaban dikirim sebagai JSON; divalidasi dulu sebelum insert. */
export async function submitResponseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    const assignmentId = String(formData.get("assignmentId") ?? "");
    const answers = JSON.parse(
      String(formData.get("answers") ?? "{}"),
    ) as Record<string, unknown>;
    await submitResponse(userId, orgId, assignmentId, answers);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true, message: "Penilaian terkirim." };
}

export async function closePeriodAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await closePeriod(userId, orgId, String(formData.get("id") ?? ""));
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true, message: "Periode ditutup, hasil diagregasi." };
}

/**
 * Submit publik lewat slug + token assignment (tanpa login). Link dibagikan
 * per penilai; unique(assignment_id) di DB membatasi satu kali.
 */
export async function submitPublicResponseAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { submitPublicResponse } = await import("@/lib/review/service");
    const answers = JSON.parse(
      String(formData.get("answers") ?? "{}"),
    ) as Record<string, unknown>;
    await submitPublicResponse(
      String(formData.get("slug") ?? ""),
      String(formData.get("assignmentId") ?? ""),
      answers,
    );
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/penilaian");
  return { ok: true, message: "Terima kasih, penilaian terkirim." };
}

// ---------------- LMS + pengumuman ----------------

export async function createCourseAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  try {
    if (!title) throw new Error("Judul kursus wajib diisi.");
    await createCourse(userId, orgId, {
      title,
      description: String(formData.get("description") ?? "").trim() || null,
    });
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
  return { ok: true, message: "Kursus ditandai selesai." };
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
    return fail(error);
  }
  revalidatePath("/pengumuman");
  return { ok: true };
}
