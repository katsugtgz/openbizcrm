import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { employees, orgMemberships, organizations, users } from "@/db/schema";
import { OrgScopeError } from "@/lib/org-scope";
import { MoneyError } from "@/lib/money";

// DB-touching modules load ONLY when RUN_DB_TESTS=1: static top-level
// @/db / repo imports would initialize the database stack even when the
// suite is skipped (cubic P2 repos.integration.test.ts:4 — same fix
// applied here).
type OrgRepo = typeof import("@/lib/repos/org-repo");
type UserRepo = typeof import("@/lib/repos/user-repo");
type BranchRepo = typeof import("@/lib/repos/branch-repo");
type MemberRepo = typeof import("@/lib/repos/member-repo");
type HrmRepo = typeof import("@/lib/repos/hrm-repo");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("hrm repos integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let createOrg!: OrgRepo["createOrg"];
  let createUser!: UserRepo["createUser"];
  let createBranch!: BranchRepo["createBranch"];
  let addMember!: MemberRepo["addMember"];
  let createDepartment!: HrmRepo["createDepartment"];
  let createEmployee!: HrmRepo["createEmployee"];
  let createShift!: HrmRepo["createShift"];
  let createOfficeWifi!: HrmRepo["createOfficeWifi"];
  let getLeaveBalance!: HrmRepo["getLeaveBalance"];
  let listAttendances!: HrmRepo["listAttendances"];
  let markAttendance!: HrmRepo["markAttendance"];
  let actLeaveApproval!: HrmRepo["actLeaveApproval"];
  let createLeaveRequest!: HrmRepo["createLeaveRequest"];
  let updateEmployee!: HrmRepo["updateEmployee"];
  let throwIfLinkRace!: HrmRepo["throwIfLinkRace"];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    ({ createOrg } = await import("@/lib/repos/org-repo"));
    ({ createUser } = await import("@/lib/repos/user-repo"));
    ({ createBranch } = await import("@/lib/repos/branch-repo"));
    ({ addMember } = await import("@/lib/repos/member-repo"));
    ({
      createDepartment,
      createEmployee,
      createShift,
      createOfficeWifi,
      getLeaveBalance,
      listAttendances,
      markAttendance,
      actLeaveApproval,
      createLeaveRequest,
      updateEmployee,
      throwIfLinkRace,
    } = await import("@/lib/repos/hrm-repo"));
  });

  // Roundtrip may fail midway; every created resource is tracked at creation
  // time so cleanup removes each independently of orgId (cubic P2 :129).
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  itDb("employee + attendance + leave roundtrip", async () => {
    const owner = await createUser({
      workosUserId: `it-hrm-owner-${suffix}`,
      email: `it-hrm-owner-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);

    const org = await createOrg(
      { name: "HRM Org", slug: `it-hrm-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);

    const approver = await createUser({
      workosUserId: `it-hrm-app-${suffix}`,
      email: `it-hrm-app-${suffix}@test.id`,
    });
    createdUserIds.push(approver.id);
    // Owner is admin-rank, so the approval chain [approver] works.
    await addMember(owner.id, org.id, approver.id, "admin");

    const dept = await createDepartment(owner.id, org.id, { name: "Eng" });
    const branch = await createBranch(owner.id, org.id, { name: "HQ HRM" });
    await createShift(owner.id, org.id, {
      name: "Office",
      startTime: "09:00",
      endTime: "17:00",
    });
    await createOfficeWifi(owner.id, org.id, {
      branchId: branch.id,
      ssid: `OFFICE-${suffix}`,
    });

    const employee = await createEmployee(owner.id, org.id, {
      departmentId: dept.id,
      branchId: branch.id,
      employeeNo: "EMP-T1",
      name: "Tes Karyawan",
      taxStatus: "TK1",
      baseSalary: 10_000_000,
    });
    await expect(
      createEmployee(owner.id, org.id, {
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
    createdUserIds.push(other.id);
    const otherOrg = await createOrg(
      { name: "Other", slug: `it-hrm-other-${suffix}` },
      other.id,
    );
    createdOrgIds.push(otherOrg.id);
    await expect(
      // employee dari org A diakses via org B (requireEmployee lempar)
      markAttendance(owner.id, otherOrg.id, {
        employeeId: employee.id,
        date: "2026-10-19",
      }),
    ).rejects.toThrow(OrgScopeError);

    // attendance: mark + upsert per employee+date
    const a1 = await markAttendance(owner.id, org.id, {
      employeeId: employee.id,
      date: "2026-10-19",
      status: "late",
      method: "wifi",
      overtimeMinutes: 60,
    });
    expect(a1.status).toBe("late");
    const a2 = await markAttendance(owner.id, org.id, {
      employeeId: employee.id,
      date: "2026-10-19",
      status: "ontime",
      overtimeMinutes: 0,
    });
    expect(a2.id).toBe(a1.id); // upsert sama row
    const rows = await listAttendances(org.id, {
      from: "2026-10-19",
      to: "2026-10-19",
    });
    expect(rows).toHaveLength(1);

    // leave: balance default 12/12, request cuti 3 hari, approve memotong
    const bal0 = await getLeaveBalance(org.id, employee.id, 2026);
    expect(bal0.cutiRemaining).toBe(12);

    const { request } = await createLeaveRequest(owner.id, org.id, {
      employeeId: employee.id,
      type: "cuti",
      startDate: "2026-11-02",
      endDate: "2026-11-04",
      approverId: approver.id,
    });
    expect(request.approvalId).toBeTruthy();

    // reject dulu: balance tidak berkurang
    await actLeaveApproval(approver.id, org.id, request.id, "reject");
    const bal1 = await getLeaveBalance(org.id, employee.id, 2026);
    expect(bal1.cutiRemaining).toBe(12);

    // request kedua, approve: cutiRemaining 12 -> 9
    const { request: req2 } = await createLeaveRequest(owner.id, org.id, {
      employeeId: employee.id,
      type: "cuti",
      startDate: "2026-11-09",
      endDate: "2026-11-11",
      approverId: approver.id,
    });
    const status = await actLeaveApproval(
      approver.id,
      org.id,
      req2.id,
      "approve",
    );
    expect(status).toBe("approved");
    const bal2 = await getLeaveBalance(org.id, employee.id, 2026);
    expect(bal2.cutiRemaining).toBe(9);

    // self-approval ditolak oleh engine
    const { request: req3 } = await createLeaveRequest(owner.id, org.id, {
      employeeId: employee.id,
      type: "izin",
      startDate: "2026-11-16",
      endDate: "2026-11-16",
      approverId: approver.id,
    });
    await expect(
      actLeaveApproval(owner.id, org.id, req3.id, "approve"),
    ).rejects.toThrow(/self-approval/i);
  });

  itDb("user link guards: non-member and already-linked rejected", async () => {
    const owner = await createUser({
      workosUserId: `it-hrm-link-owner-${suffix}`,
      email: `it-hrm-link-owner-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await createOrg(
      { name: "Link Org", slug: `it-hrm-link-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);
    const member = await createUser({
      workosUserId: `it-hrm-link-m-${suffix}`,
      email: `it-hrm-link-m-${suffix}@test.id`,
    });
    createdUserIds.push(member.id);
    await addMember(owner.id, org.id, member.id, "member");
    const outsider = await createUser({
      workosUserId: `it-hrm-link-o-${suffix}`,
      email: `it-hrm-link-o-${suffix}@test.id`,
    });
    createdUserIds.push(outsider.id);

    const base = { taxStatus: "TK0" as const, baseSalary: 5_000_000 };
    // Bukan member: tolak saat create.
    await expect(
      createEmployee(owner.id, org.id, {
        ...base,
        employeeNo: "LINK-0",
        name: "No Link",
        linkedUserId: outsider.id,
      }),
    ).rejects.toThrow(/tidak terdaftar/);
    // Tautkan member: ok.
    const emp1 = await createEmployee(owner.id, org.id, {
      ...base,
      employeeNo: "LINK-1",
      name: "Satu",
      linkedUserId: member.id,
    });
    expect(emp1.userId).toBe(member.id);
    // Sudah tertaut: tolak saat create kedua.
    await expect(
      createEmployee(owner.id, org.id, {
        ...base,
        employeeNo: "LINK-2",
        name: "Dua",
        linkedUserId: member.id,
      }),
    ).rejects.toThrow(/sudah tertaut/);
    // Sudah tertaut: tolak saat update karyawan lain.
    const emp2 = await createEmployee(owner.id, org.id, {
      ...base,
      employeeNo: "LINK-3",
      name: "Tiga",
    });
    await expect(
      updateEmployee(owner.id, org.id, emp2.id, { linkedUserId: member.id }),
    ).rejects.toThrow(/sudah tertaut/);
    await expect(
      updateEmployee(owner.id, org.id, emp2.id, { linkedUserId: outsider.id }),
    ).rejects.toThrow(/tidak terdaftar/);
  });

  itDb("link race: concurrent links map to the friendly error", async () => {
    const owner = await createUser({
      workosUserId: `it-hrm-race-owner-${suffix}`,
      email: `it-hrm-race-owner-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await createOrg(
      { name: "Race Org", slug: `it-hrm-race-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);
    const member = await createUser({
      workosUserId: `it-hrm-race-m-${suffix}`,
      email: `it-hrm-race-m-${suffix}@test.id`,
    });
    createdUserIds.push(member.id);
    await addMember(owner.id, org.id, member.id, "member");

    const base = { taxStatus: "TK0" as const, baseSalary: 5_000_000 };
    const a = await createEmployee(owner.id, org.id, {
      ...base,
      employeeNo: "RACE-A",
      name: "A",
    });
    const b = await createEmployee(owner.id, org.id, {
      ...base,
      employeeNo: "RACE-B",
      name: "B",
    });
    // Satu pemenang, satu pesan ramah — baik lewat pre-check maupun
    // mapping 23505, pesannya sama sehingga assertion deterministik.
    const results = await Promise.allSettled([
      updateEmployee(owner.id, org.id, a.id, { linkedUserId: member.id }),
      updateEmployee(owner.id, org.id, b.id, { linkedUserId: member.id }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String((failed[0] as PromiseRejectedResult).reason)).toMatch(
      /sudah tertaut/,
    );

    // Mapping cabang deterministik: bentuk drizzle asli + passthrough.
    const drizzleRace = Object.assign(new Error("duplicate key"), {
      cause: { code: "23505", constraint: "employees_org_user_unique" },
    });
    expect(() => throwIfLinkRace(drizzleRace)).toThrow(/sudah tertaut/);
    const otherConstraint = Object.assign(new Error("duplicate key"), {
      cause: { code: "23505", constraint: "employees_org_no_unique" },
    });
    expect(() => throwIfLinkRace(otherConstraint)).toThrow(otherConstraint);
    const notNull = Object.assign(new Error("null value"), {
      cause: { code: "23502", constraint: "employees_name_check" },
    });
    expect(() => throwIfLinkRace(notNull)).toThrow(notNull);
  });

  itDb("unchanged link skips validation after member departure", async () => {
    const owner = await createUser({
      workosUserId: `it-hrm-stale-owner-${suffix}`,
      email: `it-hrm-stale-owner-${suffix}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await createOrg(
      { name: "Stale Org", slug: `it-hrm-stale-${suffix}` },
      owner.id,
    );
    createdOrgIds.push(org.id);
    const member = await createUser({
      workosUserId: `it-hrm-stale-m-${suffix}`,
      email: `it-hrm-stale-m-${suffix}@test.id`,
    });
    createdUserIds.push(member.id);
    await addMember(owner.id, org.id, member.id, "member");

    const emp = await createEmployee(owner.id, org.id, {
      taxStatus: "TK0",
      baseSalary: 5_000_000,
      employeeNo: "STALE-1",
      name: "Lama",
      linkedUserId: member.id,
    });
    // User keluar org: update lain tetap jalan, tautan basi dipertahankan.
    await db
      .delete(orgMemberships)
      .where(
        and(
          eq(orgMemberships.orgId, org.id),
          eq(orgMemberships.userId, member.id),
        ),
      );
    const updated = await updateEmployee(owner.id, org.id, emp.id, {
      linkedUserId: member.id,
      name: "Nama Baru",
    });
    expect(updated.name).toBe("Nama Baru");
    expect(updated.userId).toBe(member.id);
    const [row] = await db
      .select({ userId: employees.userId })
      .from(employees)
      .where(eq(employees.id, emp.id))
      .limit(1);
    expect(row.userId).toBe(member.id);
  });
});
