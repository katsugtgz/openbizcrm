import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listAssets, monthlyDepreciation } from "@/lib/assets/service";
import { listAccounts } from "@/lib/accounting/service";
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
import { AddAssetDialog } from "./add-asset-dialog";
import { RunDepreciationDialog } from "./run-depreciation-dialog";
import { DisposeAssetButton } from "./dispose-asset-button";

export const metadata = { title: "Aset Tetap" };

async function Assets({ orgId, userId }: { orgId: string; userId: string }) {
  await requireOrgRole(userId, orgId, "member");
  const [assets, accounts] = await Promise.all([
    listAssets(orgId),
    listAccounts(orgId),
  ]);
  const accountName = new Map(
    accounts.map((a) => [a.id, `${a.code} ${a.name}`]),
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Daftar Aset</CardTitle>
          <CardDescription>
            Penyusutan garis lurus bulanan: floor((cost − salvage) / umur).
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <RunDepreciationDialog />
          <AddAssetDialog
            expenseAccounts={accounts
              .filter((a) => a.type === "expense")
              .map((a) => ({ id: a.id, code: a.code, name: a.name }))}
            assetAccounts={accounts
              .filter((a) => a.type === "asset")
              .map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          />
        </div>
      </CardHeader>
      <CardContent>
        {assets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada aset tetap.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="text-right">Perolehan</TableHead>
                <TableHead className="text-right">Bulan</TableHead>
                <TableHead className="text-right">Per Bulan</TableHead>
                <TableHead className="text-right">Tersusut</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.acquiredDate} · beban:{" "}
                      {accountName.get(a.depreciationExpenseAccountId) ?? "?"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatIDR(a.cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.usefulLifeMonths}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatIDR(monthlyDepreciation(a))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatIDR(a.totalDepreciated)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={a.status === "active" ? "default" : "secondary"}
                    >
                      {a.status === "active" ? "aktif" : "disposed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {a.status === "active" && (
                      <DisposeAssetButton assetId={a.id} />
                    )}
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

function AssetsSkeleton() {
  return <Skeleton className="h-72 w-full" />;
}

export default async function AsetPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aset Tetap</h1>
          <p className="text-sm text-muted-foreground">
            Penyusutan bulanan posting jurnal otomatis per aset.
          </p>
        </div>
        <Button asChild variant="ghost">
          <a href="/akuntansi">← Akuntansi</a>
        </Button>
      </div>
      <Suspense fallback={<AssetsSkeleton />}>
        <Assets orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}
