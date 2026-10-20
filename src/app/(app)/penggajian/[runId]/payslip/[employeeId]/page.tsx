import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payslips } from "@/db/schema";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { hasRole, requireOrgRole } from "@/lib/org-scope";
import { PayrollError, getRun } from "@/lib/payroll/service";
import { formatIDR } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { PrintButton } from "./print-button";

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between py-1.5 border-b border-dashed border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm tabular-nums ${bold ? "font-semibold" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ runId: string; employeeId: string }>;
}) {
  const { runId, employeeId } = await params;
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs (cubic P1).
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  const { userId, orgId } = ids;
  const { role } = await requireOrgRole(userId, orgId, "member");

  let run;
  try {
    run = await getRun(userId, orgId, runId);
  } catch (error) {
    if (error instanceof PayrollError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const breakdown = await loadBreakdown(orgId, runId, employeeId);
  if (!breakdown) notFound();
  // Slip gaji sensitif: hanya admin/owner atau karyawan ybs
  // (employees.userId). Member lain tidak boleh intip slip orang.
  if (!hasRole(role, "admin") && breakdown.ownerUserId !== userId) notFound();

  const b = breakdown;

  return (
    <div className="space-y-4">
      <div className="print:hidden flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link href={`/penggajian/${runId}`}>Kembali</Link>
        </Button>
        {/* ponytail: print-to-PDF via browser dialog (Ctrl+P) — tanpa lib PDF. */}
        <PrintButton />
      </div>

      <article className="mx-auto max-w-3xl space-y-6 rounded-md border bg-card p-8 print:border-0 print:shadow-none">
        <header className="text-center space-y-1 border-b pb-4">
          <h1 className="text-lg font-bold tracking-wide">SLIP GAJI</h1>
          <p className="text-sm text-muted-foreground">
            Periode: {MONTHS[run.month - 1]} {run.year}
          </p>
        </header>

        <section className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <span className="text-muted-foreground">Nama</span>
          <span className="font-medium">{b.name}</span>
          <span className="text-muted-foreground">Status Pajak</span>
          <span>{b.taxStatus}</span>
          <span className="text-muted-foreground">Hari Izin Tak Dibayar</span>
          <span>{b.unpaidLeaveDays} hari</span>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">
            Pendapatan
          </h2>
          <Row label="Gaji Pokok (prorasi)" value={formatIDR(b.proratedBase)} />
          <Row label="Lembur" value={formatIDR(b.overtime)} />
          <Row label="THR" value={formatIDR(b.thr)} />
          <Row label="Total Bruto" value={formatIDR(b.gross)} bold />
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">
            Potongan
          </h2>
          <Row label="PPh 21 (TER bulanan)" value={formatIDR(b.taxMonthly)} />
          <Row label="PPh 21 THR (TER harian)" value={formatIDR(b.taxThr)} />
          <Row
            label="BPJS Kesehatan (1%)"
            value={formatIDR(b.bpjs.kesehatanEmployee)}
          />
          <Row label="BPJS JHT (2%)" value={formatIDR(b.bpjs.jhtEmployee)} />
          <Row label="BPJS JP (1%)" value={formatIDR(b.bpjs.jpEmployee)} />
          <Row label="Total Potongan" value={formatIDR(b.deductions)} bold />
        </section>

        <section className="border-t-2 pt-3">
          <Row label="Diterima (Net)" value={formatIDR(b.net)} bold />
        </section>
      </article>
    </div>
  );
}

async function loadBreakdown(orgId: string, runId: string, employeeId: string) {
  const [row] = await db
    .select({ breakdown: payslips.breakdown, employeeName: employees.name, ownerUserId: employees.userId })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(
      and(
        eq(payslips.orgId, orgId),
        eq(payslips.runId, runId),
        eq(payslips.employeeId, employeeId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { ...row.breakdown, name: row.employeeName, ownerUserId: row.ownerUserId };
}
