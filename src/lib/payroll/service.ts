/**
 * Payroll service: org-scoped DB layer for payroll runs, payslips, and
 * bank-transfer CSV export. Pure math lives in engine.ts; attendance and
 * employee reads go through repos/hrm. Unpaid-leave days come from approved
 * `izin` leave requests (izin tanpa saldo memotong gaji; cuti/sakit tidak).
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalRequests,
  employees,
  leaveRequests,
  payrollRuns,
  payslips,
  type PayrollRun,
} from "@/db/schema";
import { listEmployeesForPayroll } from "@/lib/repos/hrm-repo";
import { requireOrgRole } from "@/lib/org-scope";
import { recordAudit } from "@/lib/repos/audit-repo";
import { currentState } from "@/lib/approval";
import {
  DEFAULT_WORKING_DAYS,
  computePayslip,
  type PayslipInput,
  type Payslip as PayslipBreakdown,
} from "./engine";

export class PayrollError extends Error {
  constructor(
    public code:
      "DUPLICATE_PERIOD" | "EMPTY_RUN" | "NOT_FOUND" | "INVALID_MONTH",
    message: string,
  ) {
    super(message);
    this.name = "PayrollError";
  }
}

/** "YYYY-MM-DD" .. "YYYY-MM-DD" untuk satu bulan kalender. */
function monthRange(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${last}` };
}

/** Hari izin approved pada bulan tsb per karyawan. */
async function unpaidLeaveDaysByEmployee(
  orgId: string,
  year: number,
  month: number,
): Promise<Map<string, number>> {
  const { from, to } = monthRange(year, month);
  const rows = await db
    .select({
      employeeId: leaveRequests.employeeId,
      type: leaveRequests.type,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      state: approvalRequests.state,
    })
    .from(leaveRequests)
    .innerJoin(
      approvalRequests,
      eq(approvalRequests.id, leaveRequests.approvalId),
    )
    .where(
      and(
        eq(leaveRequests.orgId, orgId),
        lte(leaveRequests.startDate, to),
        gte(leaveRequests.endDate, from),
      ),
    );
  const result = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "izin") continue;
    const cs = currentState(r.state);
    if (cs?.status !== "approved") continue;
    // Overlap [start,end] ∩ bulan, HARI KERJA SAJA Senin–Jumat (cubic
    // pr10 payroll:205): prorateBase berdenominator 21 hari kerja —
    // menghitung Sabtu/Minggu menggelembungkan potongan (18 hari kerja +
    // weekend = 24 hari kalender → clamp → gaji 0!).
    const s = r.startDate > from ? r.startDate : from;
    const e = r.endDate < to ? r.endDate : to;
    let days = 0;
    for (
      let d = new Date(`${s}T00:00:00Z`).getTime();
      d <= new Date(`${e}T00:00:00Z`).getTime();
      d += 86_400_000
    ) {
      const dow = new Date(d).getUTCDay();
      if (dow !== 0 && dow !== 6) days++;
    }
    if (days > 0) {
      result.set(r.employeeId, (result.get(r.employeeId) ?? 0) + days);
    }
  }
  return result;
}

/** Masa kerja bulan utuh per tanggal gajian (akhir bulan tsb). */
function monthsWorkedAt(
  hireDate: string | null,
  year: number,
  month: number,
): number {
  if (!hireDate) return 12;
  const hire = new Date(`${hireDate}T00:00:00Z`);
  const runEnd = new Date(Date.UTC(year, month, 0)); // akhir bulan run
  const months =
    (runEnd.getUTCFullYear() - hire.getUTCFullYear()) * 12 +
    (runEnd.getUTCMonth() - hire.getUTCMonth());
  return Math.max(0, months);
}

export interface RunPayrollResult {
  run: PayrollRun;
  payslips: Array<{
    employeeId: string;
    breakdown: PayslipBreakdown;
    net: number;
  }>;
}

export async function runPayroll(
  userId: string,
  orgId: string,
  period: { year: number; month: number; employeeIds?: string[] },
): Promise<RunPayrollResult> {
  await requireOrgRole(userId, orgId, "admin");
  const { year, month } = period;
  if (
    month < 1 ||
    month > 12 ||
    !Number.isInteger(month) ||
    !Number.isInteger(year)
  ) {
    throw new PayrollError(
      "INVALID_MONTH",
      "Bulan 1-12 dan tahun valid dibutuhkan.",
    );
  }

  const [existing] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.orgId, orgId),
        eq(payrollRuns.year, year),
        eq(payrollRuns.month, month),
      ),
    )
    .limit(1);
  if (existing) {
    throw new PayrollError(
      "DUPLICATE_PERIOD",
      `Payroll ${year}-${String(month).padStart(2, "0")} sudah ada.`,
    );
  }

  // Sumber staff bersama preview (cubic pr10 hrm:184): TANPA cap —
  // run membayar semua, preview harus menghitung semua.
  const staff = await listEmployeesForPayroll(orgId);
  const selected = period.employeeIds
    ? staff.filter((e) => period.employeeIds!.includes(e.id))
    : staff.filter((e) => e.status === "active");
  if (selected.length === 0) {
    throw new PayrollError(
      "EMPTY_RUN",
      "Tidak ada karyawan aktif untuk digaji.",
    );
  }

  const unpaid = await unpaidLeaveDaysByEmployee(orgId, year, month);

  // Atomik: insert run + seluruh slip + audit dalam satu transaksi —
  // crash di tengah loop me-rollback semuanya sehingga retry tidak
  // terblokir DUPLICATE_PERIOD oleh run parsial.
  return db.transaction(async (tx) => {
    let run!: PayrollRun;
    try {
      [run] = await tx
        .insert(payrollRuns)
        .values({ orgId, year, month, createdBy: userId })
        .returning();
    } catch (error) {
      // Balapan run konkuren untuk periode sama: unique
      // payroll_runs_org_period_unique — laporkan sebagai duplikat, bukan 500.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: unknown }).code === "23505"
      ) {
        throw new PayrollError(
          "DUPLICATE_PERIOD",
          `Payroll ${year}-${String(month).padStart(2, "0")} sudah ada.`,
        );
      }
      throw error;
    }
    // TS: run pasti terisi (insert gagal selalu melempar).
    const payrollRun: PayrollRun = run;

    const rows: RunPayrollResult["payslips"] = [];
    for (const emp of selected) {
      // Bulan 22–23 weekday yang semuanya izin melebihi denominator 21:
      // clamp ke batas prorasi (gaji 0 — sebulan penuh absen) supaya satu
      // karyawan tidak menggagalkan run se-organisasi. Kontrak throw
      // prorateBase untuk input liar tetap dipertahankan di engine.
      // (Hari libur nasional belum dikecualikan: repo belum punya
      // kalender libur.)
      const unpaidDays = Math.min(
        unpaid.get(emp.id) ?? 0,
        DEFAULT_WORKING_DAYS,
      );
      const input: PayslipInput = {
        employeeId: emp.id,
        name: emp.name,
        taxStatus: emp.taxStatus,
        baseSalary: emp.baseSalary,
        unpaidLeaveDays: unpaidDays,
        weekdayOvertimeHours: 0, // ponytail: agregasi jam lembur dari attendances
        restdayOvertimeHours: 0, // saat kolom otomatis tersedia; input manual menyusul.
        monthsWorked: monthsWorkedAt(emp.hireDate, year, month),
        includeThr: month === 12,
      };
      const breakdown = computePayslip(input);
      const [slip] = await tx
        .insert(payslips)
        .values({
          orgId,
          runId: payrollRun.id,
          employeeId: emp.id,
          breakdown,
          netAmount: breakdown.net,
        })
        .returning();
      rows.push({ employeeId: emp.id, breakdown, net: slip.netAmount });
    }

    await recordAudit(
      {
        orgId,
        userId,
        action: "payroll.run.create",
        entity: "payroll_run",
        entityId: payrollRun.id,
        metadata: { year, month, employees: rows.length },
      },
      tx,
    );
    return { run: payrollRun, payslips: rows };
  });
}

export async function getRun(
  userId: string,
  orgId: string,
  runId: string,
): Promise<PayrollRun> {
  await requireOrgRole(userId, orgId, "member");
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.orgId, orgId)))
    .limit(1);
  if (!run) throw new PayrollError("NOT_FOUND", "Run tidak ditemukan.");
  return run;
}

export async function listPayslips(
  userId: string,
  orgId: string,
  runId: string,
): Promise<Array<PayslipBreakdown & { employeeName: string }>> {
  await requireOrgRole(userId, orgId, "member");
  const rows = await db
    .select({ slip: payslips, name: employees.name })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(and(eq(payslips.orgId, orgId), eq(payslips.runId, runId)));
  return rows.map(({ slip, name }) => ({
    ...slip.breakdown,
    employeeName: name,
  }));
}

/**
 * Satu sel CSV bank: koma dinetralkan ke spasi (kontrak pin test CSV),
 * CR/LF dilucuti agar nama/bank/rekening tidak bisa injeksi baris.
 */
// Formula-injection guard (cubic pr10 payroll:285): bank/nama adalah
// input admin — sel diawali =, +, -, @ dieksekusi spreadsheet sebagai
// formula saat CSV dibuka.
function csvCell(value: string): string {
  const flat = value.replace(/[\r\n,]+/g, " ");
  return /^[=+\-@]/.test(flat.trimStart()) ? `'${flat}` : flat;
}

/** CSV transfer bank: bank, no rekening, nama, jumlah, berita 'GAJI YYYYMM'. */
export async function exportBankTransfer(
  userId: string,
  orgId: string,
  runId: string,
): Promise<string> {
  await requireOrgRole(userId, orgId, "admin");
  const rows = await db
    .select({ slip: payslips, emp: employees })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(and(eq(payslips.orgId, orgId), eq(payslips.runId, runId)))
    .orderBy(employees.name);
  const run = await getRun(userId, orgId, runId);
  const ym = `${run.year}${String(run.month).padStart(2, "0")}`;
  const lines = ["bank,rekening,nama,jumlah,berita"];
  for (const { slip, emp } of rows) {
    const net = slip.breakdown.net;
    const bank = csvCell(emp.bankName ?? "");
    const account = csvCell(emp.bankAccount ?? "");
    const name = csvCell(emp.name);
    lines.push(`${bank},${account},${name},${net},GAJI ${ym}`);
  }
  return lines.join("\r\n");
}
