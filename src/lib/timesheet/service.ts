import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { tasks, timesheets } from "@/db/schema";
import { NotFoundError, OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { requireTask } from "@/lib/tasks/service";

export type Timesheet = typeof timesheets.$inferSelect;

export interface TimeRange {
  from: string; // "YYYY-MM-DD" inclusive
  to: string; // "YYYY-MM-DD" inclusive
}

/**
 * Start timer untuk task. Satu timer terbuka per user (enforced di sini +
 * partial unique index where ended_at IS NULL sebagai backstop race).
 */
export async function startTimer(
  userId: string,
  orgId: string,
  taskId: string,
): Promise<Timesheet> {
  await requireOrgRole(userId, orgId, "member");
  await requireTask(orgId, taskId);
  const [open] = await db
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.userId, userId), isNull(timesheets.endedAt)))
    .limit(1);
  if (open) {
    throw new OrgScopeError(
      "INSUFFICIENT_ROLE",
      "Masih ada timer yang berjalan. Hentikan dulu sebelum memulai yang baru.",
    );
  }
  const [row] = await db
    .insert(timesheets)
    .values({ orgId, taskId, userId, startedAt: new Date() })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "timesheet.start",
    entity: "timesheet",
    entityId: row.id,
    metadata: { taskId },
  });
  return row;
}

/**
 * Stop timer terbuka user; hitung menit (bulat ke bawah, min 0).
 */
export async function stopTimer(
  userId: string,
  orgId: string,
): Promise<Timesheet> {
  await requireOrgRole(userId, orgId, "member");
  // Scope ke org: timer org lain tidak boleh ter-stop dari org ini
  // (cubic P1 timesheet:29).
  const [open] = await db
    .select()
    .from(timesheets)
    .where(
      and(
        eq(timesheets.orgId, orgId),
        eq(timesheets.userId, userId),
        isNull(timesheets.endedAt),
      ),
    )
    .limit(1);
  if (!open) {
    throw new NotFoundError("Tidak ada timer yang berjalan.");
  }
  const endedAt = new Date();
  const minutes = Math.max(
    0,
    Math.floor((endedAt.getTime() - open.startedAt.getTime()) / 60_000),
  );
  const [row] = await db
    .update(timesheets)
    .set({ endedAt, minutes })
    .where(eq(timesheets.id, open.id))
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "timesheet.stop",
    entity: "timesheet",
    entityId: row.id,
    metadata: { taskId: row.taskId, minutes },
  });
  return row;
}

/** Baris timesheet user dalam rentang tanggal (berdasarkan startedAt). */
export async function listMine(
  userId: string,
  orgId: string,
  range: TimeRange,
): Promise<Timesheet[]> {
  await requireOrgRole(userId, orgId, "member");
  return db
    .select()
    .from(timesheets)
    .where(
      and(
        eq(timesheets.orgId, orgId),
        eq(timesheets.userId, userId),
        // Batas rentang WIB: 00:00 WIB = 17:00 UTC sebelumnya (cubic P2
        // ts-page:80 — kerja sebelum 07:00 WIB tidak jatuh ke hari salah).
        gte(timesheets.startedAt, new Date(`${range.from}T00:00:00+07:00`)),
        lte(timesheets.startedAt, new Date(`${range.to}T23:59:59.999+07:00`)),
      ),
    )
    .orderBy(desc(timesheets.startedAt));
}

export interface ProjectSummary {
  projectId: string;
  taskCount: number;
  totalMinutes: number;
}

/** Rekap menit per task untuk satu proyek (semua user, rentang tanggal). */
export async function summaryByProject(
  userId: string,
  orgId: string,
  projectId: string,
  range: TimeRange,
): Promise<ProjectSummary> {
  await requireOrgRole(userId, orgId, "member");
  const rows = await db
    .select({
      taskId: tasks.id,
      minutes: timesheets.minutes,
    })
    .from(tasks)
    .leftJoin(
      timesheets,
      and(
        eq(timesheets.taskId, tasks.id),
        eq(timesheets.orgId, tasks.orgId),
        // Batas rentang WIB: 00:00 WIB = 17:00 UTC sebelumnya (cubic P2
        // ts-page:80 — kerja sebelum 07:00 WIB tidak jatuh ke hari salah).
        gte(timesheets.startedAt, new Date(`${range.from}T00:00:00+07:00`)),
        lte(timesheets.startedAt, new Date(`${range.to}T23:59:59.999+07:00`)),
      ),
    )
    .where(and(eq(tasks.orgId, orgId), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.position));
  const taskIds = new Set(rows.map((r) => r.taskId));
  const totalMinutes = rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0);
  return { projectId, taskCount: taskIds.size, totalMinutes };
}
