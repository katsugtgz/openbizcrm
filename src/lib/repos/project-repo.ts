import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmCompanies, projects, tasks } from "@/db/schema";
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
  // Hanya NotFoundError yang jadi null; error DB lain tetap naik supaya
  // outage tidak menyamar jadi "proyek tidak ada" (cubic P3 project-repo:48).
  try {
    return await requireProject(orgId, projectId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
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

/** Company wajib milik org yang sama (cubic P2 project-repo:85). */
async function requireOrgCompany(orgId: string, id: string): Promise<void> {
  const [row] = await db
    .select({ id: crmCompanies.id })
    .from(crmCompanies)
    .where(and(eq(crmCompanies.id, id), eq(crmCompanies.orgId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Perusahaan tidak ditemukan.");
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
  if (input.clientCompanyId) {
    await requireOrgCompany(orgId, input.clientCompanyId);
  }
  // Gen + insert satu transaksi: kode unik per org, race ditutup oleh
  // projects_org_code_unique (cubic P2 project-repo:78).
  const row = await db.transaction(async (tx) => {
    const code = await nextProjectCode(orgId);
    const [r] = await tx
      .insert(projects)
      .values({
        orgId,
        code,
        name: input.name,
        clientCompanyId: input.clientCompanyId ?? null,
        status: input.status ?? "planning",
      })
      .returning();
    return r;
  });
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
  // Company harus tetap milik org ini (cubic P2 schema:399).
  if (input.clientCompanyId) {
    await requireOrgCompany(orgId, input.clientCompanyId);
  }
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
