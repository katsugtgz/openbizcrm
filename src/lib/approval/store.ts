/**
 * Thin persistence for approval requests: state serialized to a jsonb column.
 * No logic here — all rules live in the pure engine.
 */
import { eq } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { db } from "@/db";
import type { ApprovalRequest } from "./engine";

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: text("request_id").notNull().unique(),
  organizationId: uuid("organization_id").notNull(),
  state: jsonb("state").$type<ApprovalRequest>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export function saveApprovalRequest(organizationId: string, req: ApprovalRequest) {
  return db
    .insert(approvalRequests)
    .values({ requestId: req.requestId, organizationId, state: req })
    .onConflictDoUpdate({
      target: approvalRequests.requestId,
      set: { state: req, updatedAt: new Date() },
    });
}

export async function getApprovalRequest(requestId: string): Promise<ApprovalRequest | null> {
  const rows = await db
    .select({ state: approvalRequests.state })
    .from(approvalRequests)
    .where(eq(approvalRequests.requestId, requestId))
    .limit(1);
  return rows[0]?.state ?? null;
}
