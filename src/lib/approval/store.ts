/**
 * Thin persistence for approval requests: state serialized to a jsonb column.
 * No logic here — all rules live in the pure engine. Table lives in
 * src/db/schema.ts (single definition — drizzle-kit reads schema.ts).
 * Every read/write is org-scoped: the organizationId participates in the
 * lookup and the conflict invariant, so one org cannot read or overwrite
 * another org's approval state.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests } from "@/db/schema";
import type { ApprovalRequest } from "./engine";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Not found, or found under a different organization (cross-org leak). */
export class ApprovalNotFoundError extends Error {
  constructor() {
    super("Approval request tidak ditemukan.");
    this.name = "ApprovalNotFoundError";
  }
}

/**
 * Upsert by (requestId, organizationId); resolves to the row id (FK target
 * for leave_requests). A requestId owned by another org is a conflict-safe
 * miss here: the where-clause keeps the invariant per-org.
 */
export async function saveApprovalRequest(
  organizationId: string,
  req: ApprovalRequest,
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.requestId, req.requestId),
        eq(approvalRequests.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (existing) {
    const [updated] = await db
      .update(approvalRequests)
      .set({ state: req })
      .where(eq(approvalRequests.id, existing.id))
      .returning();
    return { id: updated.id };
  }
  const [row] = await db
    .insert(approvalRequests)
    .values({ requestId: req.requestId, organizationId, state: req })
    .returning();
  return { id: row.id };
}

export async function getApprovalRequest(
  organizationId: string,
  requestId: string,
): Promise<ApprovalRequest | null> {
  const rows = await db
    .select({ state: approvalRequests.state })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.requestId, requestId),
        eq(approvalRequests.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0]?.state ?? null;
}

/**
 * Lookup per approval_requests.id (uuid PK), dipakai FK dari
 * leave_requests.approvalId. Org mismatch throws: callers route by
 * approvalId from form data, so a cross-org id must not resolve.
 */
export async function getApprovalRequestByRowId(
  organizationId: string,
  rowId: string,
): Promise<ApprovalRequest> {
  const rows = await db
    .select({ state: approvalRequests.state })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, rowId),
        eq(approvalRequests.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new ApprovalNotFoundError();
  return rows[0].state;
}

/**
 * Transactional variant: locks the approval row (SELECT ... FOR UPDATE)
 * so two concurrent approve/reject actors serialize — the loser sees the
 * terminal state and the engine rejects the second decision instead of
 * silently overwriting it (bughunt hr-payroll: double-decision race).
 */
export async function getApprovalRequestByRowIdForUpdate(
  tx: Tx,
  organizationId: string,
  rowId: string,
): Promise<{ id: string; state: ApprovalRequest }> {
  const rows = await tx
    .select({ id: approvalRequests.id, state: approvalRequests.state })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, rowId),
        eq(approvalRequests.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!rows[0]) throw new ApprovalNotFoundError();
  return rows[0];
}

/**
 * Transactional upsert by (requestId, organizationId). Pair with
 * getApprovalRequestByRowIdForUpdate inside one db.transaction.
 */
export async function saveApprovalRequestTx(
  tx: Tx,
  organizationId: string,
  req: ApprovalRequest,
): Promise<{ id: string }> {
  const [updated] = await tx
    .update(approvalRequests)
    .set({ state: req })
    .where(
      and(
        eq(approvalRequests.requestId, req.requestId),
        eq(approvalRequests.organizationId, organizationId),
      ),
    )
    .returning();
  if (updated) return { id: updated.id };
  const [row] = await tx
    .insert(approvalRequests)
    .values({ requestId: req.requestId, organizationId, state: req })
    .returning();
  return { id: row.id };
}
