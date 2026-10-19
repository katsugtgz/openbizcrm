import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { approvalRequests, employees, organizations, users } from "@/db/schema";
import { OrgScopeError } from "@/lib/org-scope";

// DB-touching modules load ONLY when RUN_DB_TESTS=1: static top-level
// @/db / repo imports would initialize the database stack even when the
// suite is skipped (cubic P2 repos.integration.test.ts:4 — same fix
// applied here).
type LeaveRepo = typeof import("./repo");
type OrgRepo = typeof import("@/lib/repos/org-repo");
type UserRepo = typeof import("@/lib/repos/user-repo");
type ApprovalMod = typeof import("@/lib/approval");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("leave repo integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let createApproval!: ApprovalMod["createApproval"];
  let saveApprovalRequest!: (typeof import("@/lib/approval/store"))["saveApprovalRequest"];
  let createUser!: UserRepo["createUser"];
  let createOrg!: OrgRepo["createOrg"];
  let createLeave!: LeaveRepo["createLeave"];
  let getOrCreateBalance!: LeaveRepo["getOrCreateBalance"];
  let debitBalance!: LeaveRepo["debitBalance"];
  let listLeaveRequests!: LeaveRepo["listLeaveRequests"];
  let listBalances!: LeaveRepo["listBalances"];
  let getEmployeeByUser!: LeaveRepo["getEmployeeByUser"];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    ({ createApproval } = await import("@/lib/approval"));
    ({ saveApprovalRequest } = await import("@/lib/approval/store"));
    ({ createUser } = await import("@/lib/repos/user-repo"));
    ({ createOrg } = await import("@/lib/repos/org-repo"));
    ({
      createLeave,
      getOrCreateBalance,
      debitBalance,
      listLeaveRequests,
      listBalances,
      getEmployeeByUser,
    } = await import("./repo"));
  });

  // Roundtrip may fail midway; every created resource is tracked at creation
  // time so cleanup removes each independently of orgId (cubic P2 :129).
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  let orgId = "";
  let employeeId = "";

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    if (orgId) {
      await db
        .delete(approvalRequests)
        .where(eq(approvalRequests.organizationId, orgId));
    }
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  itDb(
    "create request, list with joined state, balance roundtrip",
    async () => {
      const owner = await createUser({
        workosUserId: `lv-owner-${suffix}`,
        email: `lv-owner-${suffix}@test.id`,
      });
      createdUserIds.push(owner.id);
      const org = await createOrg(
        { name: "Leave Org", slug: `lv-org-${suffix}` },
        owner.id,
      );
      createdOrgIds.push(org.id);
      orgId = org.id;

      // outsider: user WITHOUT membership — must be rejected everywhere
      const outsider = await createUser({
        workosUserId: `lv-out-${suffix}`,
        email: `lv-out-${suffix}@test.id`,
      });
      createdUserIds.push(outsider.id);

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
        requestedBy: owner.id,
        chain: [{ approverId: "admin-x", label: "Atasan" }],
      });
      await saveApprovalRequest(orgId, approval);
      const [approvalRow] = await db
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(eq(approvalRequests.requestId, `LV-${suffix}`))
        .limit(1);

      const row = await createLeave(owner.id, orgId, {
        employeeId,
        type: "cuti",
        startDate: "2026-07-10",
        endDate: "2026-07-12",
        reason: "acara keluarga",
        approvalId: approvalRow.id,
      });
      expect(row.approvalId).toBe(approvalRow.id);
      expect(row.startDate).toBe("2026-07-10");

      const listed = await listLeaveRequests(owner.id, orgId);
      expect(listed).toHaveLength(1);
      expect(listed[0].requesterName).toBe("Budi Cuti");
      expect(listed[0].status).toBe("pending");
      expect(listed[0].currentApproverId).toBe("admin-x");

      // org scope guard
      await expect(listLeaveRequests(outsider.id, orgId)).rejects.toThrow(
        OrgScopeError,
      );
      await expect(
        createLeave(outsider.id, orgId, {
          employeeId,
          type: "cuti",
          startDate: "2026-08-01",
          endDate: "2026-08-02",
          approvalId: approvalRow.id,
        }),
      ).rejects.toThrow(OrgScopeError);

      // balance: create, debit, floor
      const bal = await getOrCreateBalance(owner.id, orgId, employeeId, 2026);
      expect(bal.cutiRemaining).toBe(12);
      expect(
        (await getOrCreateBalance(owner.id, orgId, employeeId, 2026)).id,
      ).toBe(bal.id);
      const debited = await debitBalance(
        owner.id,
        orgId,
        employeeId,
        2026,
        "cutiRemaining",
        5,
      );
      expect(debited.cutiRemaining).toBe(7);
      await expect(
        debitBalance(owner.id, orgId, employeeId, 2026, "izinRemaining", 99),
      ).resolves.toMatchObject({ izinRemaining: 0 });
      expect(await listBalances(owner.id, orgId, 2026)).toHaveLength(1);
      expect(await listBalances(owner.id, orgId, 1999)).toHaveLength(0);

      // employee lookup
      expect(await getEmployeeByUser(owner.id, orgId)).toEqual({
        id: employeeId,
      });
      const ghost = await createUser({
        workosUserId: `lv-ghost-${suffix}`,
        email: `lv-ghost-${suffix}@test.id`,
      });
      createdUserIds.push(ghost.id);
      expect(await getEmployeeByUser(ghost.id, orgId)).toBeNull();
    },
  );
});
