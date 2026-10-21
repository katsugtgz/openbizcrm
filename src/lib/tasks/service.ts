import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks, timesheets } from "@/db/schema";
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
  exec: Tx | typeof db = db,
): Promise<void> {
  const [parent] = await exec
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
  exec: Tx | typeof db = db,
): Promise<void> {
  // Recursive CTE (cubic r5 P2): satu query, tanpa N round-trip —
  // keturunan parentId yang menyentuh taskId = cycle.
  // UNION (bukan ALL — cubic r6 P1 sisa): dedupe node yang sudah
  // dikunjungi, jadi cycle data lama tak membuat rekursi tak berujung.
  const ancestors = await exec.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT t.id, t.parent_id
      FROM tasks t
      WHERE t.id = ${parentId} AND t.org_id = ${orgId}
      UNION
      SELECT t.id, t.parent_id
      FROM tasks t
      JOIN chain c ON t.id = c.parent_id
      WHERE t.org_id = ${orgId}
    )
    SELECT 1 AS hit FROM chain WHERE id = ${taskId} LIMIT 1
  `);
  const hits =
    Array.isArray(ancestors) === false && "rows" in ancestors
      ? ancestors.rows
      : (ancestors as unknown as Record<string, unknown>[]);
  if (hits.length > 0) {
    throw new OrgScopeError(
      "NO_MEMBERSHIP",
      "Parent task tidak boleh merupakan turunan dari task ini.",
    );
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
  // Assignee wajib member org ini: tanpa guard, task bisa dipasang ke user
  // org lain (cross-tenant assignment leak via daftar/kanban assignee).
  if (input.assigneeId) {
    await requireOrgRole(input.assigneeId, orgId, "member");
  }
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
  // Guard yang sama dengan createTask: input diteruskan mentah ke .set().
  if (input.assigneeId) {
    await requireOrgRole(input.assigneeId, orgId, "member");
  }
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
  // Serialize parent mutations per task pair (cubic r4 P2): two concurrent
  // updates could both pass assertNotDescendant and commit a 2-cycle
  // (A.parent = B while B.parent = A). Xact advisory lock on the ordered
  // pair inside the same transaction as the write.
  let row: Task;
  if (input.parentId !== undefined && input.parentId !== null) {
    const parentId: string = input.parentId;
    // 64-bit key via hashtext (cubic r5 P1: a 128-bit concatenated key
    // exceeds bigint range — every parent assignment failed at the lock).
    // hashtext is order-independent; canonical pair = sorted ids joined.
    const [a, b] = [taskId, parentId].sort();
    const lockKey = `${a}|${b}`;
    row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      await assertParent(orgId, task.projectId, parentId, tx);
      await assertNotDescendant(orgId, taskId, parentId, tx);
      const [updated] = await tx
        .update(tasks)
        .set(input)
        .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
        .returning();
      return updated;
    });
  } else {
    const [updated] = await db
      .update(tasks)
      .set(input)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
      .returning();
    row = updated;
  }
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

/** Batas snapshot time log di audit task.delete (sisanya cukup terhitung). */
const DELETE_TIMESHEET_SNAPSHOT_MAX = 500;

export async function deleteTask(
  userId: string,
  orgId: string,
  taskId: string,
): Promise<void> {
  await requireOrgRole(userId, orgId, "member");
  const task = await requireTask(orgId, taskId);
  // Lock project yang sama dengan reorder: delete di-serialize terhadap
  // reorder, jadi snapshot kolom reorder tidak bisa basi (cubic P2 tasks:277).
  await db.transaction(async (tx) => {
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.orgId, orgId)))
      .for("update");
    // Kunci baris task SEBELUM snapshot (cubic pr10 tasks:277): startTimer
    // memegang kunci yang sama — timer konkuren menunggu delete selesai
    // (lalu gagal not-found) alih-alih lolos dari snapshot audit. Hasil
    // lock dicek (cubic pr10 r3:9075): delete ganda tidak boleh menulis
    // audit kedua dan mengembalikan sukses.
    const [locked] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
      .for("update");
    if (!locked) throw new NotFoundError("Task tidak ditemukan.");
    // FK timesheets.task_id ON DELETE CASCADE: tanpa snapshot, hapus task
    // menghapus bukti billing. Arsipkan time log ke audit SEBELUM delete
    // (soft-delete penuh butuh kolom skema — di luar area service).
    // Snapshot TERBATAS + count terpisah (cubic pr10 tasks:288): select
    // tanpa limit memuat seluruh time log ke memori sebelum slice.
    const linked = await tx
      .select({
        id: timesheets.id,
        userId: timesheets.userId,
        startedAt: timesheets.startedAt,
        endedAt: timesheets.endedAt,
        minutes: timesheets.minutes,
        notes: timesheets.notes,
      })
      .from(timesheets)
      .where(and(eq(timesheets.taskId, taskId), eq(timesheets.orgId, orgId)))
      .orderBy(asc(timesheets.startedAt))
      .limit(DELETE_TIMESHEET_SNAPSHOT_MAX + 1)
      // Kunci baris snapshot (cubic pr10 r3:9124): stopTimer konkuren tak
      // boleh mengubah state timer setelah snapshot dibaca.
      .for("update");
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(timesheets)
      .where(and(eq(timesheets.taskId, taskId), eq(timesheets.orgId, orgId)));
    // Service-layer SET NULL (cubic pr10 schema:795): subtask FK is
    // restrict — orphan subtasks to root before deleting the parent.
    // ID yatim diaudit (cubic pr10 r2:2166): tanpa ini tak ada yang tahu
    // anak mana yang kehilangan induk.
    const orphaned = await tx
      .update(tasks)
      .set({ parentId: null })
      .where(and(eq(tasks.parentId, taskId), eq(tasks.orgId, orgId)))
      .returning();
    await tx
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));
    await recordAudit(
      {
        orgId,
        userId,
        action: "task.delete",
        entity: "task",
        entityId: taskId,
        metadata: {
          title: task.title,
          orphanedSubtaskIds: orphaned.map((t) => t.id),
          timesheetCount: total,
          timesheets: linked
            .slice(0, DELETE_TIMESHEET_SNAPSHOT_MAX)
            .map((t) => ({
              ...t,
              startedAt: t.startedAt.toISOString(),
              endedAt: t.endedAt?.toISOString() ?? null,
            })),
          timesheetsTruncated: total > DELETE_TIMESHEET_SNAPSHOT_MAX,
        },
      },
      tx,
    );
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

  const fromStatus = await db.transaction(async (tx): Promise<TaskStatus> => {
    // Serialisasi reorder dalam satu project.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.orgId, orgId)))
      .for("update");

    // Snapshot pre-lock bisa basi: reorder queued lain sudah memindahkan
    // task. Re-read + FOR UPDATE baris task di dalam lock — delete konkuren
    // harus menunggu lock ini, jadi snapshot tidak bisa dibatalkan (cubic
    // P2 tasks:277) — task hilang = request basi, tolak eksplisit.
    const [current] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
      .limit(1)
      .for("update");
    if (!current) {
      throw new Error("Permintaan reorder basi; task sudah tidak ada.");
    }
    // Status sumber di-lock: dipakai untuk branching dan audit 'from'
    // (cubic P2 tasks:328).
    const fromStatus: TaskStatus = current.status;

    // FOR UPDATE pada snapshot kolom: baris yang dibaca terkunci sampai tx
    // commit, jadi delete task manapun di kolom di-serialize (cubic P2
    // tasks:277) — tidak ada position korup dari snapshot basi.
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
        .orderBy(asc(tasks.position))
        .for("update");

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
    return fromStatus;
  });

  // Audit untuk kedua jalur (cubic P2 tasks:210).
  await recordAudit({
    orgId,
    userId,
    action: "task.reorder",
    entity: "task",
    entityId: taskId,
    metadata: { from: fromStatus, to: toStatus, toIndex },
    // fromStatus = hasil reread in-lock (bukan snapshot pre-lock `task.status`
    // yang basi — cubic P2 tasks:328).
  });
}

async function persistPositions(
  tx: Tx,
  orgId: string,
  updates: { id: string; position: number }[],
): Promise<void> {
  if (updates.length === 0) return;
  // Satu UPDATE ... CASE (bukan N UPDATE): kolom besar tidak lagi menahan
  // lock project selama N round-trip. Guard org + id sama persis dengan loop.
  const whens = updates.map(
    (u) => sql`when ${tasks.id} = ${u.id} then ${u.position}`,
  );
  await tx.execute(sql`
    update ${tasks}
    -- SET target must be unqualified: PG rejects SET "tasks"."position"
    -- (42703). Qualified refs remain fine in WHEN/WHERE below.
    set "position" = (case ${sql.join(whens, sql` `)} end)::integer
    where ${and(
      eq(tasks.orgId, orgId),
      inArray(
        tasks.id,
        updates.map((u) => u.id),
      ),
    )}
  `);
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
