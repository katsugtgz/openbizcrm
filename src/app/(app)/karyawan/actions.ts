"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
import {
  createEmployee,
  updateEmployee,
  type EmployeeInput,
} from "@/lib/repos/hrm-repo";
import { OrgScopeError } from "@/lib/org-scope";

const TAX_STATUSES = [
  "TK0",
  "TK1",
  "TK2",
  "TK3",
  "KI0",
  "KI1",
  "KI2",
  "KI3",
] as const;

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

function parseInput(formData: FormData): EmployeeInput {
  const baseSalaryRaw = String(formData.get("baseSalary") ?? "").replace(
    /[^\d]/g,
    "",
  );
  const statusRaw = String(formData.get("status") ?? "active");
  const taxRaw = String(formData.get("taxStatus") ?? "TK0");
  return {
    employeeNo: String(formData.get("employeeNo") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    status:
      statusRaw === "resigned" || statusRaw === "suspended"
        ? statusRaw
        : "active",
    taxStatus: (TAX_STATUSES as readonly string[]).includes(taxRaw)
      ? (taxRaw as EmployeeInput["taxStatus"])
      : "TK0",
    baseSalary: baseSalaryRaw ? Number(baseSalaryRaw) : NaN,
    hireDate: String(formData.get("hireDate") ?? "") || null,
    bankName: String(formData.get("bankName") ?? "").trim() || null,
    bankAccount: String(formData.get("bankAccount") ?? "").trim() || null,
  };
}

function failBack(form: "new" | "edit", message: string, id?: string): never {
  const base = form === "new" ? "/karyawan/baru" : `/karyawan/${id}/edit`;
  redirect(`${base}?error=${encodeURIComponent(message)}`);
}

export async function createEmployeeAction(formData: FormData): Promise<void> {
  const { user, orgId } = await requireSession();
  const input = parseInput(formData);
  try {
    if (!input.employeeNo) throw new Error("Nomor karyawan wajib diisi.");
    if (!input.name) throw new Error("Nama karyawan wajib diisi.");
    if (!Number.isInteger(input.baseSalary)) {
      throw new Error("Gaji pokok harus angka rupiah bulat.");
    }
    await createEmployee(user.id, orgId, input);
  } catch (error) {
    const message =
      error instanceof OrgScopeError || error instanceof Error
        ? error.message
        : "Terjadi kesalahan.";
    failBack("new", message);
  }
  revalidatePath("/karyawan");
  redirect(
    `/karyawan?ok=${encodeURIComponent(`Karyawan ${input.name} ditambahkan.`)}`,
  );
}

export async function updateEmployeeAction(formData: FormData): Promise<void> {
  const { user, orgId } = await requireSession();
  const id = String(formData.get("id") ?? "");
  const input = parseInput(formData);
  try {
    if (!id) throw new Error("Karyawan tidak ditemukan.");
    if (!input.employeeNo) throw new Error("Nomor karyawan wajib diisi.");
    if (!input.name) throw new Error("Nama karyawan wajib diisi.");
    if (!Number.isInteger(input.baseSalary)) {
      throw new Error("Gaji pokok harus angka rupiah bulat.");
    }
    await updateEmployee(user.id, orgId, id, input);
  } catch (error) {
    const message =
      error instanceof OrgScopeError || error instanceof Error
        ? error.message
        : "Terjadi kesalahan.";
    failBack("edit", message, id);
  }
  revalidatePath("/karyawan");
  redirect(
    `/karyawan?ok=${encodeURIComponent(`Data ${input.name} diperbarui.`)}`,
  );
}
