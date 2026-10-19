import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listAccounts, trialBalanceService } from "@/lib/accounting/service";
import { formatIDR } from "@/lib/money";
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
import { NewAccountDialog } from "./new-account-dialog";

export const metadata = { title: "Akuntansi" };

const TYPE_LABEL: Record<string, string> = {
  asset: "Aset",
  liability: "Liabilitas",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  expense: "Beban",
};

async function Kpis({ orgId, userId }: { orgId: string; userId: string }) {
  await requireOrgRole(userId, orgId, "member");
  const tb = await trialBalanceService(orgId);
  const pick = (type: string) =>
    tb.lines.filter((l) => l.type === type).reduce((s, l) => s + l.balance, 0);
  const laba = pick("revenue") - pick("expense");
  const kpi = [
    { label: "Total Aset", value: pick("asset") },
    { label: "Liabilitas", value: pick("liability") },
    // Ekuitas nominal + laba berjalan — tanpa laba kartu tidak cocok laporan.
    { label: "Ekuitas + Laba", value: pick("equity") + laba },
    { label: "Laba Bersih", value: laba },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpi.map((k) => (
        <Card key={k.label}>
          <CardHeader className="pb-2">
            <CardDescription>{k.label}</CardDescription>
            <CardTitle className="tabular-nums text-xl">
              {formatIDR(k.value)}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

async function ChartOfAccounts({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const accounts = await listAccounts(orgId);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Daftar Akun</CardTitle>
          <CardDescription>Chart of accounts organisasi.</CardDescription>
        </div>
        <NewAccountDialog />
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada akun. Tambahkan akun pertama (mis. 1-1000 Kas).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead className="text-right">
                  <Link
                    href="/akuntansi/buku-besar"
                    className="underline-offset-4 hover:underline"
                  >
                    Buku besar
                  </Link>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{TYPE_LABEL[a.type]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/akuntansi/buku-besar?account=${a.id}`}
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Lihat
                    </Link>
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

function AccountsSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}

export default async function AkuntansiPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs sebelum org-scoped reads.
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Akuntansi</h1>
          <p className="text-sm text-muted-foreground">
            Double-entry, jurnal, dan laporan keuangan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/akuntansi/jurnal">Jurnal</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/akuntansi/buku-besar">Buku Besar</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/akuntansi/laporan">Laporan</Link>
          </Button>
          <Button asChild>
            <Link href="/akuntansi/aset">Aset</Link>
          </Button>
        </div>
      </div>
      <Suspense fallback={<KpiSkeleton />}>
        <Kpis orgId={orgId} userId={userId} />
      </Suspense>
      <Suspense fallback={<AccountsSkeleton />}>
        <ChartOfAccounts orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}
