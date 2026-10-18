import "dotenv/config";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { createOrg } from "@/lib/repos/org-repo";
import { createUser } from "@/lib/repos/user-repo";
import { createBranch } from "@/lib/repos/branch-repo";
import {
  createDepartment,
  createEmployee,
  createShift,
  createOfficeWifi,
  getLeaveBalance,
  listAttendances,
  markAttendance,
  actLeaveApproval,
  createLeaveRequest,
} from "@/lib/repos/hrm-repo";
import { OrgScopeError } from "@/lib/org-scope";
import { MoneyError } from "@/lib/money";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("hrm repos integration", () => {
  const suffix = Date.now().toString(36);
  let orgId = "";
  let ownerId = "";
  let approverId = "";
  let employeeId = "";

  itDb("employee + attendance + leave roundtrip", async () => {
    const owner = await createUser({
      workosUserId: `it-hrm-owner-${suffix}`,
      email: `it-hrm-owner-${suffix}@test.id`,
    });
    ownerId = owner.id;

    const org = await createOrg(
      { name: "HRM Org", slug: `it-hrm-${suffix}` },
      ownerId,
    );
    orgId = org.id;

    const approver = await createUser({
      workosUserId: `it-hrm-app-${suffix}`,
      email: `it-hrm-app-${suffix}@test.id`,
    });
    approverId = approver.id;
    // member-repo addMember requires role guard; use raw insert via org repo
    // instead: addMember(approver, ...) needs approver to be member first.
    // Simplest path: owner is admin-rank so approval chain [approver] works.
    const { addMember } = await import("@/lib/repos/member-repo");
    await addMember(ownerId, orgId, approverId, "admin");

    const dept = await createDepartment(ownerId, orgId, { name: "Eng" });
    const branch = await createBranch(ownerId, orgId, { name: "HQ HRM" });
    await createShift(ownerId, orgId, {
      name: "Office",
      startTime: "09:00",
      endTime: "17:00",
    });
    await createOfficeWifi(ownerId, orgId, {
      branchId: branch.id,
      ssid: `OFFICE-${suffix}`,
    });

    const employee = await createEmployee(ownerId, orgId, {
      departmentId: dept.id,
      branchId: branch.id,
      employeeNo: "EMP-T1",
      name: "Tes Karyawan",
      taxStatus: "TK1",
      baseSalary: 10_000_000,
    });
    employeeId = employee.id;
    await expect(
      createEmployee(ownerId, orgId, {
        employeeNo: "EMP-T2",
        name: "Bad",
        baseSalary: 10.5,
      }),
    ).rejects.toThrow(MoneyError);

    // cross-org guard: org lain tak bisa lihat
    const other = await createUser({
      workosUserId: `it-hrm-o-${suffix}`,
      email: `it-hrm-o-${suffix}@test.id`,
    });
    const otherOrg = await createOrg(
      { name: "Other", slug: `it-hrm-other-${suffix}` },
      other.id,
    );
    await expect(
      // employee dari org A diakses via org B (requireEmployee lempar)
      markAttendance(ownerId, otherOrg.id, {
        employeeId,
        date: "2026-10-19",
      }),
    ).rejects.toThrow(OrgScopeError);

    // attendance: mark + upsert per employee+date
    const a1 = await markAttendance(ownerId, orgId, {
      employeeId,
      date: "2026-10-19",
      status: "late",
      method: "wifi",
      overtimeMinutes: 60,
    });
    expect(a1.status).toBe("late");
    const a2 = await markAttendance(ownerId, orgId, {
      employeeId,
      date: "2026-10-19",
      status: "ontime",
      overtimeMinutes: 0,
    });
    expect(a2.id).toBe(a1.id); // upsert sama row
    const rows = await listAttendances(orgId, {
      from: "2026-10-19",
      to: "2026-10-19",
    });
    expect(rows).toHaveLength(1);

    // leave: balance default 12/12, request cuti 3 hari, approve memotong
    const bal0 = await getLeaveBalance(orgId, employeeId, 2026);
    expect(bal0.cutiRemaining).toBe(12);

    const { request } = await createLeaveRequest(ownerId, orgId, {
      employeeId,
      type: "cuti",
      startDate: "2026-11-02",
      endDate: "2026-11-04",
      approverId,
    });
    expect(request.approvalId).toBeTruthy();

    // reject dulu: balance tidak berkurang
    await actLeaveApproval(approverId, orgId, request.id, "reject");
    const bal1 = await getLeaveBalance(orgId, employeeId, 2026);
    expect(bal1.cutiRemaining).toBe(12);

    // request kedua, approve: cutiRemaining 12 -> 9
    const { request: req2 } = await createLeaveRequest(ownerId, orgId, {
      employeeId,
      type: "cuti",
      startDate: "2026-11-09",
      endDate: "2026-11-11",
      approverId,
    });
    const status = await actLeaveApproval(
      approverId,
      orgId,
      req2.id,
      "approve",
    );
    expect(status).toBe("approved");
    const bal2 = await getLeaveBalance(orgId, employeeId, 2026);
    expect(bal2.cutiRemaining).toBe(9);

    // self-approval ditolak oleh engine
    const { request: req3 } = await createLeaveRequest(ownerId, orgId, {
      employeeId,
      type: "izin",
      startDate: "2026-11-16",
      endDate: "2026-11-16",
      approverId,
    });
    await expect(
      actLeaveApproval(ownerId, orgId, req3.id, "approve"),
    ).rejects.toThrow(/self-approval/i);

    // cleanup
    await db.delete(users).where(eq(users.id, other.id));
    await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
  });

  itDb("cleanup", async () => {
    if (!orgId) return;
    const { orgMemberships } = await import("@/db/schema");
    await db.delete(orgMemberships).where(eq(orgMemberships.orgId, orgId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, approverId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });
});
