import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { RunPayrollDialog } from "./run-dialog";
import { PayrollToasts } from "./toasts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

async function RunsTable({ orgId }: { orgId: string }) {
  const runs = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.orgId, orgId))
    .orderBy(desc(payrollRuns.year), desc(payrollRuns.month));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat Payroll</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Belum ada payroll. Jalankan payroll pertama Anda di atas.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Periode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    {MONTHS[run.month - 1]} {run.year}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={run.status === "final" ? "default" : "secondary"}
                    >
                      {run.status === "final" ? "Final" : "Draf"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/penggajian/${run.id}`}>Detail</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RunsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function PenggajianPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs; null juga berarti user belum
  // terprovision, jadi redirect sesuai kontrak pages di ids.ts.
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids;
  await requireOrgRole(userId, orgId, "member");
  const sp = await searchParams;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Penggajian</CardTitle>
          <CardDescription>
            Jalankan payroll bulanan. THR otomatis disertakan untuk periode
            Desember, proporsional masa kerja (Perpres 20/2018).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunPayrollDialog />
        </CardContent>
      </Card>

      <Suspense fallback={<RunsSkeleton />}>
        <RunsTable orgId={orgId} />
      </Suspense>

      <PayrollToasts ok={sp.ok} error={sp.error} />
    </div>
  );
}
