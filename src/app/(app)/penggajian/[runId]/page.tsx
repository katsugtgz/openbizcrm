import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import { session } from "@/lib/auth";
import { PayrollError, getRun, listPayslips } from "@/lib/payroll/service";
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

  let run;
  let slips;
  try {
    run = await getRun(user.id, orgId, runId);
    slips = await listPayslips(user.id, orgId, runId);
  } catch (error) {
    if (error instanceof PayrollError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

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

      {slips.length === 0 ? (
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
            {slips.map((s) => (
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
