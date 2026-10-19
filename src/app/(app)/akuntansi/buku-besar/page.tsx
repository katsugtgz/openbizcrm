import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listAccounts, listLedger } from "@/lib/accounting/service";
import { formatIDR } from "@/lib/money";
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

export const metadata = { title: "Buku Besar" };

async function Ledger({
  orgId,
  userId,
  accountId,
}: {
  orgId: string;
  userId: string;
  accountId?: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const accounts = await listAccounts(orgId);
  const account = accountId
    ? accounts.find((a) => a.id === accountId)
    : accounts[0];

  if (!account) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Belum ada akun. Buat akun di menu Akuntansi terlebih dahulu.
      </p>
    );
  }
  const rows = await listLedger(orgId, account.id);
  // Agregasi per entri: akun bisa muncul 2x dalam satu jurnal — render baris
  // per entri, bukan per line, agar header count & saldo berjalan
  // deterministik (cubic pr8 buku-besar:79; listLedger tak punya urutan
  // intra-entri). Urutan entri = urutan rows (date, entryNumber).
  const entryRows = new Map<
    string,
    {
      key: string;
      date: string;
      description: string | null;
      debit: number;
      credit: number;
    }
  >();
  for (const { line, entry } of rows) {
    const cur = entryRows.get(entry.id) ?? {
      key: entry.id,
      date: entry.date,
      description: entry.description,
      debit: 0,
      credit: 0,
    };
    cur.debit += line.debit;
    cur.credit += line.credit;
    entryRows.set(entry.id, cur);
  }
  const normalSign =
    account.type === "asset" || account.type === "expense" ? 1 : -1;
  let acc = 0;
  const entries = [...entryRows.values()].map((e) => {
    acc += normalSign * (e.debit - e.credit);
    return { ...e, runningBalance: acc };
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="font-mono text-sm">{account.code}</span>{" "}
          {account.name}
        </CardTitle>
        <CardDescription>
          {entries.length} transaksi posted · saldo berjalan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada baris posted pada akun ini.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Keterangan</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.key}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {e.date}
                  </TableCell>
                  <TableCell className="text-xs">
                    {e.description ?? "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.debit ? formatIDR(e.debit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.credit ? formatIDR(e.credit) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatIDR(e.runningBalance)}
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

function LedgerSkeleton() {
  return <Skeleton className="h-72 w-full" />;
}

export default async function BukuBesarPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;
  const sp = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Buku Besar</h1>
          <p className="text-sm text-muted-foreground">
            Riwayat posted per akun dengan saldo berjalan.
          </p>
        </div>
        <Link
          href="/akuntansi/jurnal"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Jurnal
        </Link>
      </div>
      <Suspense fallback={<LedgerSkeleton />}>
        <Ledger orgId={orgId} userId={userId} accountId={sp.account} />
      </Suspense>
    </div>
  );
}
