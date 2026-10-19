import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { NotFoundError, OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";

export type Project = typeof projects.$inferSelect;

export type ProjectStatus =
  "planning" | "active" | "on_hold" | "done" | "cancelled";

export interface ProjectInput {
  name: string;
  clientCompanyId?: string | null;
  status?: ProjectStatus;
}

/** Tenant guard: proyek milik org lain => NotFoundError. */
export async function requireProject(
  orgId: string,
  projectId: string,
): Promise<Project> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  if (!project) {
    throw new NotFoundError("Proyek tidak ditemukan.");
  }
  return project;
}

export async function listProjects(orgId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(asc(projects.code));
}

export async function getProject(
  orgId: string,
  projectId: string,
): Promise<Project | null> {
  try {
    return await requireProject(orgId, projectId);
  } catch {
    return null;
  }
}

/**
 * Auto-gen code "PRJ-001" per org: max numeric suffix + 1, dijual bersama
 * transaction + unique(orgId, code) backstop untuk race.
 */
async function nextProjectCode(orgId: string): Promise<string> {
  const [row] = await db
    .select({
      maxSeq: sql<number>`coalesce(max((regexp_replace(${projects.code}, '^PRJ-', ''))::int), 0)`,
    })
    .from(projects)
    .where(
      and(eq(projects.orgId, orgId), sql`${projects.code} ~ '^PRJ-[0-9]+$'`),
    );
  return `PRJ-${String((row?.maxSeq ?? 0) + 1).padStart(3, "0")}`;
}

export async function createProject(
  userId: string,
  orgId: string,
  input: ProjectInput,
): Promise<Project> {
  await requireOrgRole(userId, orgId, "admin");
  if (!input.name.trim()) {
    throw new OrgScopeError("INSUFFICIENT_ROLE", "Nama proyek wajib diisi.");
  }
  const code = await nextProjectCode(orgId);
  const [row] = await db
    .insert(projects)
    .values({
      orgId,
      code,
      name: input.name,
      clientCompanyId: input.clientCompanyId ?? null,
      status: input.status ?? "planning",
    })
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "project.create",
    entity: "project",
    entityId: row.id,
    metadata: { code: row.code, name: row.name },
  });
  return row;
}

export async function updateProject(
  userId: string,
  orgId: string,
  projectId: string,
  input: Partial<ProjectInput>,
): Promise<Project> {
  await requireOrgRole(userId, orgId, "admin");
  await requireProject(orgId, projectId);
  const [row] = await db
    .update(projects)
    .set(input)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .returning();
  await recordAudit({
    orgId,
    userId,
    action: "project.update",
    entity: "project",
    entityId: projectId,
    metadata: input as Record<string, unknown>,
  });
  return row;
}

export async function deleteProject(
  userId: string,
  orgId: string,
  projectId: string,
): Promise<void> {
  await requireOrgRole(userId, orgId, "admin");
  await requireProject(orgId, projectId);
  // Tasks/timesheets cascade via FK.
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
  await recordAudit({
    orgId,
    userId,
    action: "project.delete",
    entity: "project",
    entityId: projectId,
  });
}

/** Proyek + jumlah task per status (badge kanban ringan). */
export async function getProjectTaskCounts(
  orgId: string,
  projectId: string,
): Promise<Record<string, number>> {
  await requireProject(orgId, projectId);
  const rows = await db
    .select({ status: tasks.status, n: count() })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.projectId, projectId)))
    .groupBy(tasks.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
