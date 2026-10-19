import { and, asc, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { NotFoundError, OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { requireProject } from "@/lib/repos/project-repo";
import { moveAndRenumber } from "./reorder";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

/**
 * Cycle guard (cubic P2 tasks:129): parentId tidak boleh turunan dari task.
 * Jalan naik rantai parent dari kandidat sampai habis (tanpa batas depth);
 * kalau ketemu task => cycle. visited-Set menahan infinite loop kalau data
 * lama sudah membentuk cycle.
 */
async function assertNotDescendant(
  orgId: string,
  taskId: string,
  parentId: string,
): Promise<void> {
  const visited = new Set<string>();
  let cursor: string | null = parentId;
  while (cursor && !visited.has(cursor)) {
    if (cursor === taskId) {
      throw new OrgScopeError(
        "NO_MEMBERSHIP",
        "Parent task tidak boleh merupakan turunan dari task ini.",
      );
    }
    visited.add(cursor);
    const [row] = await db
      .select({ parentId: tasks.parentId })
      .from(tasks)
      .where(and(eq(tasks.id, cursor), eq(tasks.orgId, orgId)))
      .limit(1);
    cursor = row?.parentId ?? null;
  }
}

/**
 * Batas judul (cubic P2 0010:3, tasks:87): title masuk unique index b-tree
 * (org, project, daily_for_date, title) — limit entri b-tree PostgreSQL
 * ~2704 byte. `.length` menghitung UTF-16, bukan byte UTF-8, jadi 2.000
 * karakter non-ASCII bisa melewati batas byte dan insert gagal dengan error
 * mentah. 500 UTF-16 unit × 4 byte UTF-8 maksimal = 2.000 byte < 2.704.
 */
export const TASK_TITLE_MAX = 500;

export interface TaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  parentId?: string | null;
  dueDate?: string | null; // "YYYY-MM-DD"
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
  if (input.title.length > TASK_TITLE_MAX) {
    throw new OrgScopeError(
      "INSUFFICIENT_ROLE",
      `Judul task maksimal ${TASK_TITLE_MAX} karakter.`,
    );
  }
  if (input.parentId) {
    await assertParent(orgId, projectId, input.parentId);
  }
  const status = input.status ?? "todo";
  // Alokasi position di-serialize per proyek: lock baris project FOR UPDATE
  // di dalam transaksi, jadi max+1 dua request konkuren tidak bentrok
  // (cubic P2 tasks:106).
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from projects where id = ${projectId} for update`,
    );
    const [agg] = await tx
      .select({ maxPos: max(tasks.position) })
      .from(tasks)
      .where(
        and(
          eq(tasks.orgId, orgId),
          eq(tasks.projectId, projectId),
          eq(tasks.status, status),
        ),
      );
    const [r] = await tx
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
        position: (agg?.maxPos ?? -1) + 1,
      })
      .returning();
    return r;
  });
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
  if (input.title !== undefined && !input.title.trim()) {
    throw new OrgScopeError("INSUFFICIENT_ROLE", "Judul task wajib diisi.");
  }
  if (input.title !== undefined && input.title.length > TASK_TITLE_MAX) {
    throw new OrgScopeError(
      "INSUFFICIENT_ROLE",
      `Judul task maksimal ${TASK_TITLE_MAX} karakter.`,
    );
  }
  if (input.parentId) {
    if (input.parentId === taskId) {
      throw new OrgScopeError(
        "NO_MEMBERSHIP",
        "Task tidak bisa menjadi parent dirinya sendiri.",
      );
    }
    await assertParent(orgId, task.projectId, input.parentId);
    await assertNotDescendant(orgId, taskId, input.parentId);
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
 * Lock row project FOR UPDATE sebelum baca kolom mana pun — snapshot kolom
 * konkuren jadi serial, tidak ada duplicate position (cubic P2 tasks:257).
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

  await db.transaction(async (tx) => {
    // Serialisasi reorder dalam satu project.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.orgId, orgId)))
      .for("update");

    // Snapshot pre-lock bisa basi: reorder queued lain sudah memindahkan
    // task. Re-read di dalam lock supaya branch status pakai posisi terkini
    // (cubic P2 tasks:262) — task hilang = request basi, tolak eksplisit.
    const [current] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
      .limit(1);
    if (!current) {
      throw new Error("Permintaan reorder basi; task sudah tidak ada.");
    }

    const readColumn = (status: TaskStatus) =>
      tx
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(
          and(
            eq(tasks.orgId, orgId),
            eq(tasks.projectId, current.projectId),
            eq(tasks.status, status),
          ),
        )
        .orderBy(asc(tasks.position));

    if (current.status === toStatus) {
      // WITHIN: kolom tujuan = kolom asal (task masih di dalamnya).
      const col = await readColumn(toStatus);
      const { updates } = moveAndRenumber(col, taskId, toIndex);
      await persistPositions(tx, orgId, updates);
    } else {
      // BETWEEN: renumber KEDUA kolom (cubic P2 tasks:209) dan persist
      // position kolom tujuan termasuk task yang dipindah (cubic P1 tasks:222).
      const source = await readColumn(current.status);
      const sourceRest = source.filter((t) => t.id !== taskId);
      const sourceUpdates = sourceRest
        .map((t, i) => ({ id: t.id, position: i }))
        .filter((u, i) => u.position !== sourceRest[i].position);

      const target = await readColumn(toStatus);
      const index = Math.min(Math.max(toIndex, 0), target.length);
      const inserted = [
        ...target.slice(0, index),
        { id: taskId, position: current.position },
        ...target.slice(index),
      ];
      const { updates } = moveAndRenumber(inserted, taskId, index);
      await tx
        .update(tasks)
        .set({ status: toStatus, position: index })
        .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));
      await persistPositions(tx, orgId, [...sourceUpdates, ...updates]);
    }
  });

  // Audit untuk kedua jalur (cubic P2 tasks:210).
  await recordAudit({
    orgId,
    userId,
    action: "task.reorder",
    entity: "task",
    entityId: taskId,
    metadata: { from: task.status, to: toStatus, toIndex },
    // task.status = pre-lock snapshot untuk audit only; logika di atas pakai
    // `current` (re-read in-lock, cubic P2 tasks:262).
  });
}

async function persistPositions(
  tx: Tx,
  orgId: string,
  updates: { id: string; position: number }[],
): Promise<void> {
  for (const u of updates) {
    await tx
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
