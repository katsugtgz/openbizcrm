import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireOrgRole } from "@/lib/org-scope";

export type AuditLog = typeof auditLogs.$inferSelect;

export async function recordAudit(input: {
  orgId: string;
  userId: string;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<AuditLog> {
  const [log] = await db
    .insert(auditLogs)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? null,
    })
    .returning();
  return log;
}

export async function listAuditLogs(
  userId: string,
  orgId: string,
  limit = 50,
): Promise<AuditLog[]> {
  await requireOrgRole(userId, orgId, "member");
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.orgId, orgId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function listAuditLogsByEntity(
  userId: string,
  orgId: string,
  entity: string,
  entityId: string,
): Promise<AuditLog[]> {
  await requireOrgRole(userId, orgId, "member");
  return db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.orgId, orgId),
        eq(auditLogs.entity, entity),
        eq(auditLogs.entityId, entityId),
      ),
    )
    .orderBy(desc(auditLogs.createdAt));
}
