/**
 * Thin persistence for approval requests: state serialized to a jsonb column.
 * No logic here — all rules live in the pure engine. Table lives in
 * src/db/schema.ts (single definition — drizzle-kit reads schema.ts).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalRequests } from "@/db/schema";
import type { ApprovalRequest } from "./engine";

/** Upsert by requestId; resolves to the row id (FK target for leave_requests). */
export async function saveApprovalRequest(
  organizationId: string,
  req: ApprovalRequest,
): Promise<{ id: string }> {
  await db
    .insert(approvalRequests)
    .values({ requestId: req.requestId, organizationId, state: req })
    .onConflictDoUpdate({
      target: approvalRequests.requestId,
      set: { state: req, updatedAt: new Date() },
    });
  const [row] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(eq(approvalRequests.requestId, req.requestId))
    .limit(1);
  return row;
}

export async function getApprovalRequest(
  requestId: string,
): Promise<ApprovalRequest | null> {
  const rows = await db
    .select({ state: approvalRequests.state })
    .from(approvalRequests)
    .where(eq(approvalRequests.requestId, requestId))
    .limit(1);
  return rows[0]?.state ?? null;
}

/** Lookup per approval_requests.id (uuid PK), dipakai FK dari leave_requests.approvalId. */
export async function getApprovalRequestByRowId(
  rowId: string,
): Promise<ApprovalRequest | null> {
  const rows = await db
    .select({ state: approvalRequests.state })
    .from(approvalRequests)
    .where(eq(approvalRequests.id, rowId))
    .limit(1);
  return rows[0]?.state ?? null;
}
