import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, orgMemberships } from "@/db/schema";
import { OrgScopeError, requireOrgRole } from "@/lib/org-scope";

export type AuditLog = typeof auditLogs.$inferSelect;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Audit transaction-aware (cubic P1 audit-repo: accounting:183 /
 * invoicing:271 / pos:57): pemanggil di dalam transaksi wajib pass tx agar
 * audit tidak menyewa koneksi kedua dari global pool dan ikut atomic dengan
 * transaksi. Default `db` untuk pemanggil tanpa tx.
 */
export async function recordAudit(
  input: {
    orgId: string;
    userId: string;
    action: string;
    entity?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  exec: Tx | typeof db = db,
): Promise<AuditLog> {
  // The attributed user must actually belong to the org, or any caller could
  // fabricate cross-tenant / falsely attributed audit history
  // (cubic P2 audit-repo:16).
  const [membership] = await exec
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, input.orgId),
        eq(orgMemberships.userId, input.userId),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new OrgScopeError(
      "NO_MEMBERSHIP",
      "Pengguna bukan anggota organisasi ini.",
    );
  }
  const [log] = await exec
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

export type AuditTx = Tx;

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
