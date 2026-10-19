"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks as tasksTable, taskTemplates, timesheets } from "@/db/schema";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { jakartaDateISO } from "@/lib/attendance/rules";
import { assertProjectInOrg } from "@/lib/tasks/service";
import { recordAudit } from "@/lib/repos/audit-repo";
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

/**
 * Auth boundary: WorkOS session IDs -> internal UUIDs (cubic P0 proyek:39).
 * requireOrgRole/repos accept database UUIDs only; session user.id/orgId
 * are WorkOS "user_…"/"org_…" values and fail the UUID contract.
 */
async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return { user, ...ids };
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan.";
}

// ---------------- Projects ----------------

export async function createProjectAction(
  formData: FormData,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const clientCompanyId = String(formData.get("clientCompanyId") ?? "") || null;
  try {
    if (!name) throw new Error("Nama proyek wajib diisi.");
    await createProject(userId, orgId, { name, clientCompanyId });
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
  const { userId, orgId } = await requireSession();
  try {
    await updateProject(userId, orgId, projectId, {
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
  const { userId, orgId } = await requireSession();
  try {
    await deleteProject(userId, orgId, projectId);
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
  const { userId, orgId } = await requireSession();
  const projectId = String(formData.get("projectId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const priority = String(formData.get("priority") ?? "medium");
  const dueDate = String(formData.get("dueDate") ?? "") || null;
  try {
    if (!title) throw new Error("Judul task wajib diisi.");
    await createTask(userId, orgId, projectId, {
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
  projectId: string,
  taskId: string,
  toStatus: string,
  toIndex: number,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await reorderTask(
      userId,
      orgId,
      taskId,
      toStatus as TaskStatus,
      Math.max(0, Math.trunc(toIndex)),
    );
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  // Revalidate: tanpa ini kartu kembali ke kolom lama sementara toast bilang
  // sukses (cubic P1 task-board:225).
  revalidatePath(`/proyek/${projectId}`);
  return { ok: true };
}

export async function setTaskDueAction(
  taskId: string,
  projectId: string,
  dueDate: string,
): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await updateTask(userId, orgId, taskId, { dueDate: dueDate || null });
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
  const { userId, orgId } = await requireSession();
  try {
    await deleteTask(userId, orgId, taskId);
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
  const { userId, orgId } = await requireSession();
  try {
    await startTimer(userId, orgId, taskId);
  } catch (error) {
    return { ok: false, error: errMessage(error) };
  }
  revalidatePath(`/proyek/${projectId}`);
  revalidatePath("/proyek/timesheet");
  return { ok: true };
}

export async function stopTimerAction(): Promise<ActionResult> {
  const { userId, orgId } = await requireSession();
  try {
    await stopTimer(userId, orgId);
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
  const { userId, orgId } = await requireSession();
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
    await requireOrgRole(userId, orgId, "admin");
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
  const { userId, orgId } = await requireSession();
  try {
    await requireOrgRole(userId, orgId, "admin");
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
  const { userId, orgId } = await requireSession();
  try {
    const templates = await db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.orgId, orgId))
      .orderBy(asc(taskTemplates.name));
    if (templates.length === 0) throw new Error("Belum ada template tugas.");

    // WIB kalender, bukan UTC — 00:00–06:59 WIB UTC masih hari sebelumnya
    // (cubic P2 proyek-actions:266).
    const today = jakartaDateISO(new Date());
    await requireOrgRole(userId, orgId, "member");
    await assertProjectInOrg(orgId, projectId);
    // Atomic check-and-create: unique (org, project, title, dueDate) +
    // onConflictDoNothing menutup duplikat template & request konkuren
    // (cubic P2 proyek-actions:279). Pre-read hanya optimasi counter.
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

    let created = 0;
    for (const t of templates) {
      if (existingTitles.has(t.name)) continue;
      const [row] = await db
        .insert(tasksTable)
        .values({
          orgId,
          projectId,
          title: t.name,
          description: t.description,
          priority: t.priority,
          dueDate: today,
          position: 0,
        })
        .onConflictDoNothing({
          target: [
            tasksTable.orgId,
            tasksTable.projectId,
            tasksTable.title,
            tasksTable.dueDate,
          ],
        })
        .returning();
      if (row) {
        created++;
        await recordAudit({
          orgId,
          userId,
          action: "task.create",
          entity: "task",
          entityId: row.id,
          metadata: { projectId, title: row.title, daily: true },
        });
      }
    }
    revalidatePath(`/proyek/${projectId}`);
    return { ok: true, created };
  } catch (error) {
    return { ok: false, created: 0, error: errMessage(error) };
  }
}

/** Timer terbuka milik user (untuk banner). */
export async function getOpenTimerAction(): Promise<{
  ok: boolean;
  timer: { id: string; taskId: string } | null;
}> {
  const { userId, orgId } = await requireSession();
  const [open] = await db
    .select({ id: timesheets.id, taskId: timesheets.taskId })
    .from(timesheets)
    .where(
      and(
        eq(timesheets.userId, userId),
        eq(timesheets.orgId, orgId),
        isNull(timesheets.endedAt),
      ),
    )
    .limit(1);
  return { ok: true, timer: open ?? null };
}
