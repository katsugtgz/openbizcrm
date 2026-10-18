"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
import { runPayroll, PayrollError } from "@/lib/payroll/service";
import { computePayslip } from "@/lib/payroll/engine";
import { listEmployees } from "@/lib/repos/hrm-repo";
import { requireOrgRole } from "@/lib/org-scope";

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const orgId =
    user.organizationId ??
    (
      await db
        .select({ orgId: schemaUsers.currentOrgId })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, user.id))
        .limit(1)
    )[0]?.orgId;
  if (!orgId) throw new Error("Tidak ada organisasi aktif.");
  return { user, orgId };
}

export async function runPayrollAction(
  formData: FormData,
): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const { user, orgId } = await requireSession();
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  try {
    await runPayroll(user.id, orgId, { year, month });
  } catch (error) {
    const message =
      error instanceof PayrollError || error instanceof Error
        ? error.message
        : "Terjadi kesalahan.";
    return { ok: false, error: message };
  }
  revalidatePath("/penggajian");
  const okMsg = encodeURIComponent(
    `Payroll ${year}-${String(month).padStart(2, "0")} selesai dijalankan.`,
  );
  return { ok: true, redirectTo: `/penggajian?ok=${okMsg}` };
}

/** Ringkasan sebelum run: jumlah karyawan aktif + total bruto/net. */
export async function previewPayrollAction(
  formData: FormData,
): Promise<
  | {
      ok: true;
      preview: {
        employeeCount: number;
        totalBruto: number;
        totalNet: number;
        month: number;
        year: number;
      };
    }
  | { ok: false; error: string }
> {
  const { user, orgId } = await requireSession();
  // Preview menampar total gaji seluruh pegawai — admin-only, sama seperti run.
  await requireOrgRole(user.id, orgId, "admin");
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  try {
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
    const staff = await listEmployees(orgId);
    const active = staff.filter((e) => e.status === "active");
    if (active.length === 0) {
      throw new PayrollError(
        "EMPTY_RUN",
        "Tidak ada karyawan aktif untuk digaji.",
      );
    }
    let totalBruto = 0;
    let totalNet = 0;
    for (const emp of active) {
      const b = computePayslip({
        employeeId: emp.id,
        name: emp.name,
        taxStatus: emp.taxStatus,
        baseSalary: emp.baseSalary,
        unpaidLeaveDays: 0,
        weekdayOvertimeHours: 0,
        restdayOvertimeHours: 0,
        monthsWorked: 12,
        includeThr: month === 12,
      });
      totalBruto += b.gross;
      totalNet += b.net;
    }
    return {
      ok: true,
      preview: {
        employeeCount: active.length,
        totalBruto,
        totalNet,
        month,
        year,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Terjadi kesalahan.";
    return { ok: false, error: message };
  }
}
