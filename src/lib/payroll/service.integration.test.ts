import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { orgMemberships, organizations, payrollRuns, users } from "@/db/schema";

// DB-touching modules load ONLY when RUN_DB_TESTS=1: static top-level
// @/db / repo / service imports would initialize the database stack even
// when the suite is skipped (cubic P2 repos.integration.test.ts:4 — same
// fix applied here).
type PayrollService = typeof import("./service");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("payroll service integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let createUser!: (typeof import("@/lib/repos/user-repo"))["createUser"];
  let createOrg!: (typeof import("@/lib/repos/org-repo"))["createOrg"];
  let createEmployee!: (typeof import("@/lib/repos/hrm-repo"))["createEmployee"];
  let createLeaveRequest!: (typeof import("@/lib/repos/hrm-repo"))["createLeaveRequest"];
  let actLeaveApproval!: (typeof import("@/lib/repos/hrm-repo"))["actLeaveApproval"];
  let PayrollError!: PayrollService["PayrollError"];
  let runPayroll!: PayrollService["runPayroll"];
  let previewPayrollTotals!: PayrollService["previewPayrollTotals"];
  let throwIfPayrollRace!: PayrollService["throwIfPayrollRace"];
  let exportBankTransfer!: PayrollService["exportBankTransfer"];
  let getRun!: PayrollService["getRun"];

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    ({ createUser } = await import("@/lib/repos/user-repo"));
    ({ createOrg } = await import("@/lib/repos/org-repo"));
    ({ createEmployee, createLeaveRequest, actLeaveApproval } =
      await import("@/lib/repos/hrm-repo"));
    ({
      PayrollError,
      runPayroll,
      previewPayrollTotals,
      throwIfPayrollRace,
      exportBankTransfer,
      getRun,
    } = await import("./service"));
  });

  // Roundtrip may fail midway; track every resource at creation time so
  // cleanup removes each independently of orgId (cubic P2 :129 pattern).
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  let orgId = "";
  let adminId = "";
  let memberId = "";
  let empA = "";
  let empB = "";

  itDb(
    "runPayroll: known-answer run, duplicate guard, CSV export",
    async () => {
      const admin = await createUser({
        workosUserId: `pay-admin-${suffix}`,
        email: `pay-admin-${suffix}@test.id`,
      });
      adminId = admin.id;
      createdUserIds.push(admin.id);
      const member = await createUser({
        workosUserId: `pay-member-${suffix}`,
        email: `pay-member-${suffix}@test.id`,
      });
      memberId = member.id;
      createdUserIds.push(member.id);
      const org = await createOrg(
        { name: "Pay Org", slug: `pay-org-${suffix}` },
        adminId,
      );
      orgId = org.id;
      createdOrgIds.push(org.id);
      await db
        .insert(orgMemberships)
        .values({ orgId, userId: memberId, role: "member" });

      // Karyawan: TK1, gaji 5.190.000 (habis dibagi 173), 12 bulan kerja.
      const a = await createEmployee(adminId, orgId, {
        employeeNo: "PAY-A",
        name: "Budi,Gaji",
        taxStatus: "TK1",
        baseSalary: 5_190_000,
        hireDate: "2020-01-01",
        bankName: "BCA",
        bankAccount: "1234567890",
      });
      empA = a.id;
      const b = await createEmployee(adminId, orgId, {
        employeeNo: "PAY-B",
        name: "Sari",
        taxStatus: "KI0",
        baseSalary: 2_100_000,
        hireDate: "2026-09-15", // baru 1 bulan utk Desember 2026
      });
      empB = b.id;

      const year = 2026;
      const month = 12; // THR bulan
      const { run, payslips } = await runPayroll(adminId, orgId, {
        year,
        month,
      });
      expect(run.year).toBe(year);
      expect(run.month).toBe(month);
      expect(run.status).toBe("draft");
      expect(payslips).toHaveLength(2);

      const slipA = payslips.find((p) => p.employeeId === empA)!.breakdown;
      // Tanpa lembur: bruto = gaji + THR = 10.380.000.
      expect(slipA.gross).toBe(10_380_000);
      expect(slipA.thr).toBe(5_190_000);
      // TER bulanan: bruto gaji 5.19jt (bracket 1, TK/1, 25 bps) = 12.975;
      // THR lewat TER harian; BPJS 207.600.
      expect(slipA.taxMonthly).toBe(12_975);
      expect(slipA.taxThr).toBe(12_975);
      expect(slipA.bpjs.employeeTotal).toBe(207_600);
      expect(slipA.deductions).toBe(233_550);
      expect(slipA.net).toBe(10_380_000 - 233_550);

      const slipB = payslips.find((p) => p.employeeId === empB)!.breakdown;
      // KI0 di bracket 1: 0 bps PPh; THR 3 bulan (Sep-Des) => floor(2,1jt x 3/12).
      expect(slipB.thr).toBe(525_000);
      expect(slipB.taxMonthly).toBe(0);
      expect(slipB.taxThr).toBe(0);

      // Duplicate period ditolak.
      await expect(runPayroll(adminId, orgId, { year, month })).rejects.toThrow(
        PayrollError,
      );

      // Role guard: member tidak boleh menjalankan payroll.
      await expect(
        runPayroll(memberId, orgId, { year: 2027, month: 1 }),
      ).rejects.toThrow();

      // CSV: koma di nama dijagospace, header + 2 baris, berita GAJI 202612.
      const csv = await exportBankTransfer(adminId, orgId, run.id);
      const lines = csv.split("\r\n");
      expect(lines[0]).toBe("bank,rekening,nama,jumlah,berita");
      expect(lines).toHaveLength(3);
      expect(csv).toContain("GAJI 202612");
      expect(csv).toContain("BCA,1234567890,Budi Gaji,");
      expect(csv).toContain(String(slipA.net));
    },
  );

  itDb("getRun org-scoped: org lain tidak bisa akses", async () => {
    const other = await createUser({
      workosUserId: `pay-other-${suffix}`,
      email: `pay-other-${suffix}@test.id`,
    });
    createdUserIds.push(other.id);
    const otherOrg = await createOrg(
      { name: "Other Org", slug: `pay-other-${suffix}` },
      other.id,
    );
    createdOrgIds.push(otherOrg.id);
    // adminId punya run di orgId; org lain tidak melihatnya (NOT_FOUND).
    const runs = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.orgId, orgId));
    expect(runs.length).toBeGreaterThan(0);
    await expect(getRun(other.id, otherOrg.id, runs[0].id)).rejects.toThrow(
      PayrollError,
    );
  });

  itDb("throwIfPayrollRace maps the concurrent-run conflict only", async () => {
    const drizzleRace = Object.assign(new Error("duplicate key"), {
      cause: { code: "23505", constraint: "payroll_runs_org_period_unique" },
    });
    try {
      throwIfPayrollRace(drizzleRace, 2026, 12);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PayrollError);
      expect((error as InstanceType<typeof PayrollError>).code).toBe(
        "DUPLICATE_PERIOD",
      );
    }
    // Constraint lain / kode lain: lempar ulang apa adanya.
    const other = Object.assign(new Error("duplicate key"), {
      cause: { code: "23505", constraint: "payroll_runs_pkey" },
    });
    expect(() => throwIfPayrollRace(other, 2026, 12)).toThrow(other);
    const notNull = Object.assign(new Error("null value"), {
      cause: { code: "23502", constraint: "payroll_runs_org_period_unique" },
    });
    expect(() => throwIfPayrollRace(notNull, 2026, 12)).toThrow(notNull);
  });

  itDb(
    "previewPayrollTotals matches runPayroll (izin + mid-year hire)",
    async () => {
      const admin = await createUser({
        workosUserId: `pay-prev-admin-${suffix}`,
        email: `pay-prev-admin-${suffix}@test.id`,
      });
      createdUserIds.push(admin.id);
      const approver = await createUser({
        workosUserId: `pay-prev-appr-${suffix}`,
        email: `pay-prev-appr-${suffix}@test.id`,
      });
      createdUserIds.push(approver.id);
      const org = await createOrg(
        { name: "Preview Org", slug: `pay-prev-${suffix}` },
        admin.id,
      );
      createdOrgIds.push(org.id);
      await db
        .insert(orgMemberships)
        .values({ orgId: org.id, userId: approver.id, role: "admin" });

      const emp = await createEmployee(admin.id, org.id, {
        employeeNo: "PREV-1",
        name: "Paritas",
        taxStatus: "TK0",
        baseSalary: 6_000_000,
        hireDate: "2026-06-15", // 6 bulan kerja utk Desember 2026
      });

      const year = 2026;
      const month = 12;
      const before = await previewPayrollTotals(org.id, year, month);
      expect(before.employeeCount).toBe(1);

      // Izin approved 3 hari kerja (Senin-Rabu, 7-9 Des 2026).
      const { request } = await createLeaveRequest(admin.id, org.id, {
        employeeId: emp.id,
        type: "izin",
        startDate: "2026-12-07",
        endDate: "2026-12-09",
        approverId: approver.id,
      });
      await actLeaveApproval(approver.id, org.id, request.id, "approve");

      // Preview mencerminkan izin: net turun setelah approval.
      const after = await previewPayrollTotals(org.id, year, month);
      expect(after.totalNet).toBeLessThan(before.totalNet);

      // Run memakai input hitung yang sama persis: total identik.
      const { payslips } = await runPayroll(admin.id, org.id, { year, month });
      expect(payslips).toHaveLength(1);
      const gross = payslips.reduce((s, p) => s + p.breakdown.gross, 0);
      const net = payslips.reduce((s, p) => s + p.net, 0);
      expect(after.totalBruto).toBe(gross);
      expect(after.totalNet).toBe(net);
      // Masa kerja 6 bulan, bukan 12: THR prorata setengah gaji.
      expect(payslips[0].breakdown.thr).toBe(3_000_000);
    },
  );

  // Org deletion cascades memberships/employees/payslips; deletes registered
  // resources even when the roundtrip fails midway (cubic P2 :129).
  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
  });
});
