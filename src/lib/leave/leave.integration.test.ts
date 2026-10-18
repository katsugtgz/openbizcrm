import "dotenv/config";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalRequests,
  employees,
  orgMemberships,
  organizations,
  users,
} from "@/db/schema";
import { createApproval } from "@/lib/approval";
import { saveApprovalRequest } from "@/lib/approval/store";
import { createUser } from "@/lib/repos/user-repo";
import { createOrg } from "@/lib/repos/org-repo";
import {
  createLeave,
  getOrCreateBalance,
  debitBalance,
  listLeaveRequests,
  listBalances,
  getEmployeeByUser,
} from "./repo";
import { OrgScopeError } from "@/lib/org-scope";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("leave repo integration", () => {
  const suffix = Date.now().toString(36);
  let orgId = "";
  let ownerId = "";
  let outsiderId = "";
  let employeeId = "";

  itDb(
    "create request, list with joined state, balance roundtrip",
    async () => {
      const owner = await createUser({
        workosUserId: `lv-owner-${suffix}`,
        email: `lv-owner-${suffix}@test.id`,
      });
      ownerId = owner.id;
      const org = await createOrg(
        { name: "Leave Org", slug: `lv-org-${suffix}` },
        ownerId,
      );
      orgId = org.id;

      // outsider: user WITHOUT membership — must be rejected everywhere
      const outsider = await createUser({
        workosUserId: `lv-out-${suffix}`,
        email: `lv-out-${suffix}@test.id`,
      });
      outsiderId = outsider.id;

      const [employee] = await db
        .insert(employees)
        .values({
          orgId,
          employeeNo: `EMP-LV-${suffix}`,
          name: "Budi Cuti",
          baseSalary: 5_000_000,
          userId: owner.id,
        })
        .returning();
      employeeId = employee.id;

      // approval chain + leave row
      const approval = createApproval({
        requestId: `LV-${suffix}`,
        requestedBy: ownerId,
        chain: [{ approverId: "admin-x", label: "Atasan" }],
      });
      await saveApprovalRequest(orgId, approval);
      const [approvalRow] = await db
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(eq(approvalRequests.requestId, `LV-${suffix}`))
        .limit(1);

      const row = await createLeave(ownerId, orgId, {
        employeeId,
        type: "cuti",
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        reason: "acara keluarga",
        approvalId: approvalRow.id,
      });
      expect(row.approvalId).toBe(approvalRow.id);
      expect(row.startDate).toBe("2026-07-10");

      const listed = await listLeaveRequests(ownerId, orgId);
      expect(listed).toHaveLength(1);
      expect(listed[0].requesterName).toBe("Budi Cuti");
      expect(listed[0].status).toBe("pending");
      expect(listed[0].currentApproverId).toBe("admin-x");

      // org scope guard
      await expect(listLeaveRequests(outsiderId, orgId)).rejects.toThrow(
        OrgScopeError,
      );
      await expect(
        createLeave(outsiderId, orgId, {
          employeeId,
          type: "cuti",
          startDate: "2026-08-01",
          endDate: "2026-08-02",
          approvalId: approvalRow.id,
        }),
      ).rejects.toThrow(OrgScopeError);

      // balance: create, debit, floor
      const bal = await getOrCreateBalance(ownerId, orgId, employeeId, 2026);
      expect(bal.cutiRemaining).toBe(12);
      expect(
        (await getOrCreateBalance(ownerId, orgId, employeeId, 2026)).id,
      ).toBe(bal.id);
      const debited = await debitBalance(
        ownerId,
        orgId,
        employeeId,
        2026,
        "cutiRemaining",
        5,
      );
      expect(debited.cutiRemaining).toBe(7);
      await expect(
        debitBalance(ownerId, orgId, employeeId, 2026, "izinRemaining", 99),
      ).resolves.toMatchObject({ izinRemaining: 0 });
      expect(await listBalances(ownerId, orgId, 2026)).toHaveLength(1);
      expect(await listBalances(ownerId, orgId, 1999)).toHaveLength(0);

      // employee lookup
      expect(await getEmployeeByUser(owner.id, orgId)).toEqual({
        id: employeeId,
      });
      const ghost = await createUser({
        workosUserId: `lv-ghost-${suffix}`,
        email: `lv-ghost-${suffix}@test.id`,
      });
      expect(await getEmployeeByUser(ghost.id, orgId)).toBeNull();

      // cleanup ghost
      await db.delete(users).where(eq(users.id, ghost.id));
    },
  );

  itDb("cleanup", async () => {
    if (!orgId) return;
    await db
      .delete(approvalRequests)
      .where(eq(approvalRequests.organizationId, orgId));
    await db.delete(orgMemberships).where(eq(orgMemberships.orgId, orgId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, outsiderId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });
});
