/**
 * Leave persistence: org-scoped. All writes go through requireOrgRole.
 * Pure logic lives in ../leave/service.ts; this file is the ONLY db access
 * for leave requests and balances. Approval state lives in approval_requests
 * (via approval store) — leaveRequests.approvalId points at that row.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalRequests,
  employees,
  leaveBalances,
  leaveRequests,
} from "@/db/schema";
import { requireOrgRole } from "@/lib/org-scope";
import { currentState, type ApprovalRequest } from "@/lib/approval";

export type LeaveRow = typeof leaveRequests.$inferSelect;
export type LeaveBalanceRow = typeof leaveBalances.$inferSelect;

export interface LeaveListItem extends LeaveRow {
  requesterName: string | null;
  status: ApprovalRequest["status"];
  currentApproverId: string | null;
}

export async function listLeaveRequests(
  userId: string,
  orgId: string,
  opts?: { employeeId?: string },
): Promise<LeaveListItem[]> {
  await requireOrgRole(userId, orgId, "member");
  const conds = [eq(leaveRequests.orgId, orgId)];
  if (opts?.employeeId)
    conds.push(eq(leaveRequests.employeeId, opts.employeeId));
  const rows = await db
    .select({
      leave: leaveRequests,
      requesterName: employees.name,
      state: approvalRequests.state,
    })
    .from(leaveRequests)
    .leftJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .leftJoin(
      approvalRequests,
      eq(approvalRequests.id, leaveRequests.approvalId),
    )
    .where(and(...conds))
    .orderBy(desc(leaveRequests.startDate), desc(leaveRequests.createdAt));
  return rows.map(({ leave, requesterName, state }) => {
    const cs = state ? currentState(state) : null;
    return {
      ...leave,
      requesterName,
      status: cs?.status ?? "pending",
      currentApproverId: cs?.currentApproverId ?? null,
    };
  });
}

export async function getLeaveState(
  userId: string,
  orgId: string,
  approvalId: string,
): Promise<ApprovalRequest | null> {
  await requireOrgRole(userId, orgId, "member");
  const rows = await db
    .select({ state: approvalRequests.state })
    .from(approvalRequests)
    .where(eq(approvalRequests.id, approvalId))
    .limit(1);
  return rows[0]?.state ?? null;
}

/** Persists one leave request; caller saves the approval state via the store. */
export async function createLeave(
  actorId: string,
  orgId: string,
  input: {
    employeeId: string;
    type: LeaveRow["type"];
    startDate: string;
    endDate: string;
    reason?: string | null;
    approvalId: string;
  },
): Promise<LeaveRow> {
  await requireOrgRole(actorId, orgId, "member");
  const [row] = await db
    .insert(leaveRequests)
    .values({
      orgId,
      employeeId: input.employeeId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason ?? null,
      approvalId: input.approvalId,
    })
    .returning();
  return row;
}

export async function getOrCreateBalance(
  userId: string,
  orgId: string,
  employeeId: string,
  year: number,
): Promise<LeaveBalanceRow> {
  await requireOrgRole(userId, orgId, "member");
  const [existing] = await db
    .select()
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.orgId, orgId),
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.year, year),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(leaveBalances)
    .values({ orgId, employeeId, year })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [row] = await db
    .select()
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.orgId, orgId),
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.year, year),
      ),
    )
    .limit(1);
  return row;
}

export async function debitBalance(
  actorId: string,
  orgId: string,
  employeeId: string,
  year: number,
  field: "cutiRemaining" | "izinRemaining",
  days: number,
): Promise<LeaveBalanceRow> {
  await requireOrgRole(actorId, orgId, "member");
  const [row] = await db
    .update(leaveBalances)
    .set(
      field === "cutiRemaining"
        ? {
            cutiRemaining: sql`GREATEST(0, ${leaveBalances.cutiRemaining} - ${days})`,
          }
        : {
            izinRemaining: sql`GREATEST(0, ${leaveBalances.izinRemaining} - ${days})`,
          },
    )
    .where(
      and(
        eq(leaveBalances.orgId, orgId),
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.year, year),
      ),
    )
    .returning();
  if (!row) {
    const err = new Error("Saldo cuti tidak ditemukan.");
    err.name = "NotFoundError";
    throw err;
  }
  return row;
}

export async function listBalances(
  userId: string,
  orgId: string,
  year: number,
): Promise<LeaveBalanceRow[]> {
  await requireOrgRole(userId, orgId, "member");
  return db
    .select()
    .from(leaveBalances)
    .where(and(eq(leaveBalances.orgId, orgId), eq(leaveBalances.year, year)));
}

/** Resolved employee id from the session user (must be linked to an employee). */
export async function getEmployeeByUser(
  userId: string,
  orgId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), eq(employees.userId, userId)))
    .limit(1);
  return row ?? null;
}
