import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { PayrollError, getRun, listPayslips } from "@/lib/payroll/service";
import { hasRole, requireOrgRole } from "@/lib/org-scope";
import { getEmployeeByUser } from "@/lib/leave/repo";
import { formatIDR } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs; null juga berarti user belum
  // terprovision, jadi redirect sesuai kontrak pages di ids.ts.
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids;

  const { role } = await requireOrgRole(userId, orgId, "member");
  // Member hanya melihat baris slip miliknya sendiri; admin/owner semua.
  const selfEmployee = hasRole(role, "admin") ? null : await getEmployeeByUser(userId, orgId);
  let run;
  let slips;
  try {
    run = await getRun(userId, orgId, runId);
    slips = await listPayslips(userId, orgId, runId);
  } catch (error) {
    if (error instanceof PayrollError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // Admin/owner sees every row; a linked member sees only their own; a
  // member WITHOUT a linked employee sees nothing (cubic pr10: null must
  // not mean admin).
  const visible = hasRole(role, "admin")
    ? slips
    : selfEmployee
      ? slips.filter((s) => s.employeeId === selfEmployee.id)
      : [];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Payroll {MONTHS[run.month - 1]} {run.year}
        </h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/penggajian">Kembali</Link>
          </Button>
          <Button asChild size="sm">
            <a href={`/api/penggajian/${run.id}/export.csv`}>Unduh CSV Bank</a>
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Tidak ada slip gaji untuk run ini.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Karyawan</TableHead>
              <TableHead className="text-right">Gaji Pokok</TableHead>
              <TableHead className="text-right">Lembur</TableHead>
              <TableHead className="text-right">THR</TableHead>
              <TableHead className="text-right">Potongan</TableHead>
              <TableHead className="text-right">Diterima</TableHead>
              <TableHead className="text-right">Slip</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((s) => (
              <TableRow key={s.employeeId}>
                <TableCell>{s.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatIDR(s.proratedBase)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatIDR(s.overtime)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatIDR(s.thr)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatIDR(s.deductions)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatIDR(s.net)}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    className="text-sm underline"
                    href={`/penggajian/${run.id}/payslip/${s.employeeId}`}
                  >
                    Slip Gaji
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
