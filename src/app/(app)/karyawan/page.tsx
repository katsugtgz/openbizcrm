import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listEmployees } from "@/lib/repos/hrm-repo";
import { formatIDR } from "@/lib/money";
import { KaryawanToasts } from "./toasts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  resigned: "bg-gray-100 text-gray-700",
  suspended: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Aktif",
  resigned: "Resign",
  suspended: "Suspended",
};

async function EmployeeTable({ orgId }: { orgId: string }) {
  const employees = await listEmployees(orgId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftar Karyawan</CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Belum ada karyawan. Tambahkan karyawan pertama Anda.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/karyawan/baru">Tambah Karyawan</Link>
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pajak</TableHead>
                <TableHead className="text-right">Gaji Pokok</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">{e.employeeNo}</TableCell>
                  <TableCell className="font-medium">
                    <Link
                      className="hover:underline"
                      href={`/karyawan/${e.id}`}
                    >
                      {e.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE[e.status] ?? ""}>
                      {STATUS_LABEL[e.status] ?? e.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{e.taxStatus}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatIDR(e.baseSalary)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/karyawan/${e.id}/edit`}>Edit</Link>
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

function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function KaryawanPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs before the org-scoped reads.
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  // Membership is guaranteed by the resolver; requireOrgRole enforces the
  // role (and keeps the guard consistent with sibling pages).
  await requireOrgRole(ids.userId, ids.orgId, "member");
  const { orgId } = ids;
  const sp = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Karyawan</h1>
          <p className="text-sm text-muted-foreground">
            Kelola data karyawan, status, dan gaji pokok.
          </p>
        </div>
        <Button asChild>
          <Link href="/karyawan/baru">Tambah Karyawan</Link>
        </Button>
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <EmployeeTable orgId={orgId} />
      </Suspense>
      <KaryawanToasts ok={sp.ok} error={sp.error} />
    </div>
  );
}
