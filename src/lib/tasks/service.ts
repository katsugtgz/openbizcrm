import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { NotFoundError, OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { requireProject } from "@/lib/repos/project-repo";
import { moveAndRenumber } from "./reorder";

export type Task = typeof tasks.$inferSelect;

export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

/** Tenant guard: task milik org lain => NotFoundError. */
export async function requireTask(
  orgId: string,
  taskId: string,
): Promise<Task> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .limit(1);
  if (!task) {
    throw new NotFoundError("Task tidak ditemukan.");
  }
  return task;
}

/** Self-ref guard: parentId harus task di org & proyek yang sama. */
async function assertParent(
  orgId: string,
  projectId: string,
  parentId: string,
): Promise<void> {
  const [parent] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, parentId), eq(tasks.orgId, orgId)))
    .limit(1);
  if (!parent || parent.projectId !== projectId) {
    throw new OrgScopeError(
      "NO_MEMBERSHIP",
      "Parent task tidak ditemukan di proyek ini.",
    );
  }
}

export interface TaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  parentId?: string | null;
  dueDate?: string | null; // "YYYY-MM-DD"
}

/** Next position dalam satu kolom kanban (max + 1). */
async function nextPosition(
  orgId: string,
  projectId: string,
  status: TaskStatus,
): Promise<number> {
  const rows = await db
    .select({ position: tasks.position })
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, orgId),
        eq(tasks.projectId, projectId),
        eq(tasks.status, status),
      ),
    )
    .orderBy(asc(tasks.position));
  return rows.length > 0 ? rows[rows.length - 1].position + 1 : 0;
}

export async function createTask(
  userId: string,
  orgId: string,
  projectId: string,
  input: TaskInput,
): Promise<Task> {
  await requireOrgRole(userId, orgId, "member");
  await requireProject(orgId, projectId);
  if (!input.title.trim()) {
    throw new OrgScopeError("INSUFFICIENT_ROLE", "Judul task wajib diisi.");
  }
  if (input.parentId) {
    await assertParent(orgId, projectId, input.parentId);
  }
  const status = input.status ?? "todo";
  const [row] = await db
    .insert(tasks)
    .values({
      orgId,
      projectId,
      title: input.title,
      description: input.description ?? null,
      status,
      priority: input.priority ?? "medium",
      assigneeId: input.assigneeId ?? null,
      parentId: input.parentId ?? null,
      dueDate: input.dueDate ?? null,
      position: await nextPosition(orgId, projectId, status),
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "task.create",
    entity: "task",
    entityId: row.id,
    metadata: { projectId, title: row.title, status, priority: row.priority },
  });
  return row;
}

export async function updateTask(
  userId: string,
  orgId: string,
  taskId: string,
  input: Partial<TaskInput>,
): Promise<Task> {
  await requireOrgRole(userId, orgId, "member");
  const task = await requireTask(orgId, taskId);
  if (input.parentId) {
    await assertParent(orgId, task.projectId, input.parentId);
  }
  const [row] = await db
    .update(tasks)
    .set(input)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "task.update",
    entity: "task",
    entityId: taskId,
    metadata: input as Record<string, unknown>,
  });
  return row;
}

export async function deleteTask(
  userId: string,
  orgId: string,
  taskId: string,
): Promise<void> {
  await requireOrgRole(userId, orgId, "member");
  await requireTask(orgId, taskId);
  await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));
  await recordAudit({
    orgId,
    userId,
    action: "task.delete",
    entity: "task",
    entityId: taskId,
  });
}

export async function listTasks(
  userId: string,
  orgId: string,
  projectId: string,
): Promise<Task[]> {
  await requireOrgRole(userId, orgId, "member");
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.position));
}

/**
 * Kanban reorder: pindahkan task ke status & index tujuan, renumber kolom
 * asal + tujuan. Urutan relatif item lain dijaga (moveAndRenumber, TDD).
 */
export async function reorderTask(
  userId: string,
  orgId: string,
  taskId: string,
  toStatus: TaskStatus,
  toIndex: number,
): Promise<void> {
  await requireOrgRole(userId, orgId, "member");
  const task = await requireTask(orgId, taskId);

  // Kolom tujuan (urut position saat ini).
  const target = await db
    .select({ id: tasks.id, position: tasks.position })
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, orgId),
        eq(tasks.projectId, task.projectId),
        eq(tasks.status, toStatus),
      ),
    )
    .orderBy(asc(tasks.position));

  if (task.status === toStatus) {
    // WITHIN: kolom tujuan = kolom asal (task masih di dalamnya).
    const { updates } = moveAndRenumber(target, taskId, toIndex);
    await persistPositions(orgId, updates);
    return;
  }

  // BETWEEN: keluarkan task dari kolom asal, hitung index tujuan pada
  // kolom tujuan tanpa task itu, lalu sisipkan.
  const withoutMoving = target.filter((t) => t.id !== taskId);
  const index = Math.min(Math.max(toIndex, 0), withoutMoving.length);
  const inserted = [
    ...withoutMoving.slice(0, index),
    { id: taskId, position: task.position },
    ...withoutMoving.slice(index),
  ];
  const { updates } = moveAndRenumber(
    inserted.map((it, i) => ({ ...it, position: i })),
    taskId,
    index,
  );
  await db
    .update(tasks)
    .set({ status: toStatus })
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));
  await persistPositions(orgId, updates);
  await recordAudit({
    orgId,
    userId,
    action: "task.reorder",
    entity: "task",
    entityId: taskId,
    metadata: { from: task.status, to: toStatus, toIndex },
  });
}

async function persistPositions(
  orgId: string,
  updates: { id: string; position: number }[],
): Promise<void> {
  for (const u of updates) {
    await db
      .update(tasks)
      .set({ position: u.position })
      .where(and(eq(tasks.id, u.id), eq(tasks.orgId, orgId)));
  }
}

/** Project milik org? (helper UI actions) */
export async function assertProjectInOrg(
  orgId: string,
  projectId: string,
): Promise<void> {
  const [p] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  if (!p) throw new NotFoundError("Proyek tidak ditemukan.");
}
