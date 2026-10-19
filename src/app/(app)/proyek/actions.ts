"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  tasks as tasksTable,
  taskTemplates,
  timesheets,
  users as schemaUsers,
} from "@/db/schema";
import { session } from "@/lib/auth";
import { requireOrgRole } from "@/lib/org-scope";
import {
  createProject,
  updateProject,
  deleteProject,
} from "@/lib/repos/project-repo";
import {
  createTask,
  updateTask,
  deleteTask,
  reorderTask,
  type TaskStatus,
} from "@/lib/tasks/service";
import { startTimer, stopTimer } from "@/lib/timesheet/service";

export interface ActionResult {
  ok: boolean;
  error?: string;
  redirectTo?: string;
}

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const orgId =
    user.organizationId ??
    (
      await db
        .select({ orgId: schemaUsers.currentOrgId })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, user.id))
        .limit(1)
    )[0]?.orgId;
  if (!orgId) throw new Error("Tidak ada organisasi aktif.");
  return { user, orgId };
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan.";
}

// ---------------- Projects ----------------

export async function createProjectAction(
  formData: FormData,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const clientCompanyId = String(formData.get("clientCompanyId") ?? "") || null;
  try {
    if (!name) throw new Error("Nama proyek wajib diisi.");
    await createProject(user.id, orgId, { name, clientCompanyId });
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath("/proyek");
  return { ok: true };
}

export async function updateProjectStatusAction(
  projectId: string,
  status: string,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await updateProject(user.id, orgId, projectId, {
      status: status as
        "planning" | "active" | "on_hold" | "done" | "cancelled",
    });
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath("/proyek");
  revalidatePath(`/proyek/${projectId}`);
  return { ok: true };
}

export async function deleteProjectAction(
  projectId: string,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await deleteProject(user.id, orgId, projectId);
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath("/proyek");
  return { ok: true, redirectTo: "/proyek" };
}

// ---------------- Tasks ----------------

export async function createTaskAction(
  formData: FormData,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium");
  const dueDate = String(formData.get("dueDate") ?? "") || null;
  try {
    if (!title) throw new Error("Judul task wajib diisi.");
    await createTask(user.id, orgId, projectId, {
      title,
      priority: priority as "low" | "medium" | "high" | "urgent",
      dueDate,
    });
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath(`/proyek/${projectId}`);
  return { ok: true };
}

export async function reorderTaskAction(
  taskId: string,
  toStatus: string,
  toIndex: number,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await reorderTask(
      user.id,
      orgId,
      taskId,
      toStatus as TaskStatus,
      Math.max(0, Math.trunc(toIndex)),
    );
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  return { ok: true };
}

export async function setTaskDueAction(
  taskId: string,
  projectId: string,
  dueDate: string,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await updateTask(user.id, orgId, taskId, { dueDate: dueDate || null });
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath(`/proyek/${projectId}`);
  return { ok: true };
}

export async function deleteTaskAction(
  taskId: string,
  projectId: string,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await deleteTask(user.id, orgId, taskId);
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath(`/proyek/${projectId}`);
  return { ok: true };
}

// ---------------- Timesheet ----------------

export async function startTimerAction(
  taskId: string,
  projectId: string,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await startTimer(user.id, orgId, taskId);
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath(`/proyek/${projectId}`);
  revalidatePath("/proyek/timesheet");
  return { ok: true };
}

export async function stopTimerAction(): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await stopTimer(user.id, orgId);
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath("/proyek/timesheet");
  return { ok: true };
}

// ---------------- Tugas Harian (templates) ----------------

const TEMPLATE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export async function createTemplateAction(
  formData: FormData,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const priorityRaw = String(formData.get("priority") ?? "medium");
  const priority = (TEMPLATE_PRIORITIES as readonly string[]).includes(
    priorityRaw,
  )
    ? (priorityRaw as (typeof TEMPLATE_PRIORITIES)[number])
    : "medium";
  try {
    if (!name) throw new Error("Nama template wajib diisi.");
    // createProject membutuhkan role admin; template dibatasi admin juga.
    await requireOrgRole(user.id, orgId, "admin");
    await db.insert(taskTemplates).values({ orgId, name, priority });
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath("/proyek/harian");
  return { ok: true };
}

export async function deleteTemplateAction(
  templateId: string,
): Promise<ActionResult> {
  const { user, orgId } = await requireSession();
  try {
    await requireOrgRole(user.id, orgId, "admin");
    await db
      .delete(taskTemplates)
      .where(
        and(eq(taskTemplates.id, templateId), eq(taskTemplates.orgId, orgId)),
      );
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath("/proyek/harian");
  return { ok: true };
}

/**
 * Generate task hari ini dari semua template ke proyek pilihan.
 * Skip template yang sudah jadi task hari ini (judul sama, proyek sama).
 */
export async function generateTodayAction(
  projectId: string,
): Promise<ActionResult & { created: number }> {
  const { user, orgId } = await requireSession();
  try {
    const templates = await db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.orgId, orgId))
      .orderBy(asc(taskTemplates.name));
    if (templates.length === 0) throw new Error("Belum ada template tugas.");

    const today = new Date().toISOString().slice(0, 10);
    const existing = await db
      .select({ title: tasksTable.title })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.orgId, orgId),
          eq(tasksTable.projectId, projectId),
          eq(tasksTable.dueDate, today),
        ),
      );
    const existingTitles = new Set(existing.map((r) => r.title));

    const todo = templates.filter((t) => !existingTitles.has(t.name));
    for (const t of todo) {
      await createTask(user.id, orgId, projectId, {
        title: t.name,
        description: t.description,
        priority: t.priority,
        dueDate: today,
      });
    }
    revalidatePath(`/proyek/${projectId}`);
    return { ok: true, created: todo.length };
  } catch (error) {
    return { ok: false, created: 0, error: errMessage(error) };
  }
}

/** Timer terbuka milik user (untuk banner). */
export async function getOpenTimerAction(): Promise<{
  ok: boolean;
  timer: { id: string; taskId: string } | null;
}> {
  const { user, orgId } = await requireSession();
  const [open] = await db
    .select({ id: timesheets.id, taskId: timesheets.taskId })
    .from(timesheets)
    .where(
      and(
        eq(timesheets.userId, user.id),
        eq(timesheets.orgId, orgId),
        isNull(timesheets.endedAt),
      ),
    )
    .limit(1);
  return { ok: true, timer: open ?? null };
}
