"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import {
  previewPayrollTotals,
  runPayroll,
  PayrollError,
} from "@/lib/payroll/service";
import { requireOrgRole } from "@/lib/org-scope";

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs (cubic P1 penggajian-actions:18).
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return ids;
}

export async function runPayrollAction(
  formData: FormData,
): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const { userId, orgId } = await requireSession();
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  try {
    await runPayroll(userId, orgId, { year, month });
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
export async function previewPayrollAction(formData: FormData): Promise<
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
  const { userId, orgId } = await requireSession();
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  try {
    // Preview menampar total gaji seluruh pegawai — admin-only, sama seperti
    // run; di dalam try agar OrgScopeError tercatat sebagai { ok:false }.
    await requireOrgRole(userId, orgId, "admin");
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
    // Kalkulator bersama run: roster dan input hitung (unpaid riil, masa
    // kerja riil) identik, sehingga preview tidak menyimpang dari run untuk
    // izin-approved dan hire tengah tahun.
    const totals = await previewPayrollTotals(orgId, year, month);
    if (totals.employeeCount === 0) {
      throw new PayrollError(
        "EMPTY_RUN",
        "Tidak ada karyawan aktif untuk digaji.",
      );
    }
    return {
      ok: true,
      preview: { ...totals, month, year },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Terjadi kesalahan.";
    return { ok: false, error: message };
  }
}
