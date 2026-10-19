import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listInvoices } from "@/lib/invoicing/service";
import { listCompanies } from "@/lib/repos/crm-repo";
import { formatIDR } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
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
import { NewInvoiceDialog } from "./new-invoice-dialog";

export const metadata = { title: "Faktur" };

const STATUS_LABEL: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  draft: { label: "draft", variant: "secondary" },
  sent: { label: "terkirim", variant: "default" },
  paid: { label: "lunas", variant: "default" },
  overdue: { label: "jatuh tempo", variant: "destructive" },
  cancelled: { label: "batal", variant: "outline" },
};

async function InvoiceTable({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const [invoices, companies] = await Promise.all([
    listInvoices(orgId),
    listCompanies(orgId),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftar Faktur</CardTitle>
        <CardDescription>
          Draft belum berdampak jurnal; kirim untuk posting AR.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada faktur.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor</TableHead>
                <TableHead>Perusahaan</TableHead>
                <TableHead>Jatuh Tempo</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Dibayar</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const s = STATUS_LABEL[inv.status] ?? {
                  label: inv.status,
                  variant: "outline" as const,
                };
                return (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link
                        href={`/faktur/${inv.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {inv.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {companyName.get(inv.companyId) ?? "-"}
                    </TableCell>
                    <TableCell className="text-xs">{inv.dueDate}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatIDR(inv.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatIDR(inv.paidAmount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}

export default async function FakturPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Faktur</h1>
          <p className="text-sm text-muted-foreground">
            Invoice penjualan dengan jurnal AR otomatis.
          </p>
        </div>
        <Suspense fallback={null}>
          <NewInvoiceGate orgId={orgId} userId={userId} />
        </Suspense>
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <InvoiceTable orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}

async function NewInvoiceGate({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const companies = await listCompanies(orgId);
  return (
    <NewInvoiceDialog
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
    />
  );
}
