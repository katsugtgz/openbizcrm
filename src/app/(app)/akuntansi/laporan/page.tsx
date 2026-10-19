import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { balanceSheet, incomeStatement } from "@/lib/accounting/service";
import { formatIDR } from "@/lib/money";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const metadata = { title: "Laporan Keuangan" };

function ReportTable({
  rows,
  totalLabel,
  total,
}: {
  rows: {
    account: { id: string; code: string; name: string };
    balance: number;
  }[];
  totalLabel: string;
  total: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        Belum ada data posted.
      </p>
    );
  }
  return (
    <>
      <Table>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.account.id}>
              <TableCell>
                <span className="font-mono text-xs">{r.account.code}</span>{" "}
                {r.account.name}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatIDR(r.balance)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="flex justify-between border-t px-3 pt-2 text-sm font-medium tabular-nums">
        <span>{totalLabel}</span>
        <span>{formatIDR(total)}</span>
      </p>
    </>
  );
}

async function Reports({ orgId, userId }: { orgId: string; userId: string }) {
  await requireOrgRole(userId, orgId, "member");
  const [income, bs] = await Promise.all([
    incomeStatement(orgId),
    balanceSheet(orgId),
  ]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Laba Rugi</CardTitle>
          <CardDescription>
            Pendapatan vs beban periode berjalan (posted).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Pendapatan
            </p>
            <ReportTable
              rows={income.revenue}
              totalLabel="Total pendapatan"
              total={income.revenue.reduce((s, r) => s + r.balance, 0)}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Beban
            </p>
            <ReportTable
              rows={income.expense}
              totalLabel="Total beban"
              total={income.expense.reduce((s, r) => s + r.balance, 0)}
            />
          </div>
          <p className="flex justify-between rounded-md bg-muted p-3 text-sm font-semibold tabular-nums">
            <span>Laba bersih</span>
            <span>{formatIDR(income.netIncome)}</span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Neraca</CardTitle>
          <CardDescription>
            Aset = liabilitas + ekuitas + laba ditahan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Aset
            </p>
            <ReportTable
              rows={bs.asset}
              totalLabel="Total aset"
              total={bs.asset.reduce((s, r) => s + r.balance, 0)}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Liabilitas
            </p>
            <ReportTable
              rows={bs.liability}
              totalLabel="Total liabilitas"
              total={bs.liability.reduce((s, r) => s + r.balance, 0)}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Ekuitas
            </p>
            <ReportTable
              rows={bs.equity}
              totalLabel="Total ekuitas"
              total={bs.equity.reduce((s, r) => s + r.balance, 0)}
            />
          </div>
          <p className="flex justify-between rounded-md bg-muted p-3 text-sm tabular-nums">
            <span>Laba ditahan</span>
            <span>{formatIDR(bs.retainedEarnings)}</span>
          </p>
          <p
            className={
              bs.balanced
                ? "text-xs text-muted-foreground"
                : "text-xs font-medium text-destructive"
            }
          >
            {bs.balanced
              ? "Neraca seimbang."
              : "Neraca TIDAK seimbang — periksa entri jurnal."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ReportsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton className="h-96 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default async function LaporanPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Laporan Keuangan
          </h1>
          <p className="text-sm text-muted-foreground">
            Laba rugi dan neraca dari jurnal posted.
          </p>
        </div>
        <Link
          href="/akuntansi"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Akuntansi
        </Link>
      </div>
      <Suspense fallback={<ReportsSkeleton />}>
        <Reports orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}
