import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  orgMemberships,
  organizations,
  payrollRuns,
  users,
} from "@/db/schema";
import { createUser } from "@/lib/repos/user-repo";
import { createOrg } from "@/lib/repos/org-repo";
import { createEmployee } from "@/lib/repos/hrm-repo";
import {
  PayrollError,
  runPayroll,
  exportBankTransfer,
  getRun,
} from "./service";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("payroll service integration", () => {
  const suffix = Date.now().toString(36);
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
      const member = await createUser({
        workosUserId: `pay-member-${suffix}`,
        email: `pay-member-${suffix}@test.id`,
      });
      memberId = member.id;
      const org = await createOrg(
        { name: "Pay Org", slug: `pay-org-${suffix}` },
        adminId,
      );
      orgId = org.id;
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
    const otherOrg = await createOrg(
      { name: "Other Org", slug: `pay-other-${suffix}` },
      other.id,
    );
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

  afterAll(async () => {
    if (orgId) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
      await db.delete(users).where(eq(users.id, adminId));
      await db.delete(users).where(eq(users.id, memberId));
      await db.delete(employees).where(eq(employees.orgId, orgId));
    }
  });
});
