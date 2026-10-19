import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { getInvoice, listInvoicePayments } from "@/lib/invoicing/service";
import { listCompanies, listContacts } from "@/lib/repos/crm-repo";
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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaymentDialog } from "../payment-dialog";
import {
  CancelInvoiceButton,
  MarkOverdueButton,
  SendInvoiceButton,
} from "../invoice-buttons";
import { PrintButton } from "./print-button";

export const metadata = { title: "Detail Faktur" };

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

async function InvoiceDetail({
  orgId,
  userId,
  invoiceId,
}: {
  orgId: string;
  userId: string;
  invoiceId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const data = await getInvoice(orgId, invoiceId);
  if (!data) notFound();
  const { invoice, items } = data;
  const [company] = await Promise.all([
    listCompanies(orgId).then((cs) =>
      cs.find((c) => c.id === invoice.companyId),
    ),
    listContacts(orgId),
  ]);
  const payments = await listInvoicePayments(orgId, invoiceId);
  const remaining = invoice.total - invoice.paidAmount;
  const s = STATUS_LABEL[invoice.status] ?? {
    label: invoice.status,
    variant: "outline" as const,
  };
  const payable = invoice.status === "sent" || invoice.status === "overdue";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href="/faktur"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Faktur
          </Link>
          <Badge variant={s.variant}>{s.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton />
          {invoice.status === "draft" && (
            <>
              <CancelInvoiceButton invoiceId={invoice.id} />
              <SendInvoiceButton invoiceId={invoice.id} />
            </>
          )}
          {invoice.status === "sent" && (
            <MarkOverdueButton invoiceId={invoice.id} />
          )}
          {payable && (
            <PaymentDialog invoiceId={invoice.id} remaining={remaining} />
          )}
        </div>
      </div>

      {/* Lembar faktur: container print CSS via print:block print:border-0 */}
      <Card className="print:border-0 print:shadow-none">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-semibold">
              FAKTUR {invoice.invoiceNumber}
            </CardTitle>
            <CardDescription>
              {company?.name ?? "-"} · terbit {invoice.issueDate} · jatuh tempo{" "}
              {invoice.dueDate}
            </CardDescription>
          </div>
          <div className="text-right text-xs text-muted-foreground print:text-black">
            <p className="font-semibold">OpenBizCRM</p>
            <p>Invoice penjualan</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Deskripsi</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Harga</TableHead>
                <TableHead className="text-right">Jumlah</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.description}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {it.qty}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatIDR(it.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatIDR(it.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm tabular-nums">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatIDR(invoice.subtotal)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">
                PPN {invoice.taxPct}%
              </span>
              <span>{formatIDR(invoice.taxAmount)}</span>
            </p>
            <Separator />
            <p className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatIDR(invoice.total)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Dibayar</span>
              <span>{formatIDR(invoice.paidAmount)}</span>
            </p>
            <p className="flex justify-between font-medium">
              <span>Sisa</span>
              <span>{formatIDR(remaining)}</span>
            </p>
          </div>
          {invoice.notes && (
            <p className="text-xs text-muted-foreground">{invoice.notes}</p>
          )}
          {payments.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground print:hidden">
                Riwayat pembayaran
              </p>
              <ul className="space-y-1 text-xs tabular-nums">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span>
                      {p.paidAt} · {p.method}
                    </span>
                    <span>{formatIDR(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DetailSkeleton() {
  return <Skeleton className="h-96 w-full" />;
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;
  const { invoiceId } = await params;

  return (
    <Suspense fallback={<DetailSkeleton />}>
      <InvoiceDetail orgId={orgId} userId={userId} invoiceId={invoiceId} />
    </Suspense>
  );
}
