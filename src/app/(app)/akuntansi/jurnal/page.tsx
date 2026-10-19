import { Suspense } from "react";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { hasRole, requireOrgRole } from "@/lib/org-scope";
import { listAccounts } from "@/lib/accounting/service";
import { jakartaDateISO } from "@/lib/attendance/rules";
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
import { NewEntryDialog } from "../new-entry-dialog";
import { PostEntryButton } from "./post-entry-button";
import { ClosePeriodDialog } from "./close-period-dialog";

export const metadata = { title: "Jurnal" };

async function Entries({ orgId, userId }: { orgId: string; userId: string }) {
  await requireOrgRole(userId, orgId, "member");
  const [entries, accounts] = await Promise.all([
    db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.orgId, orgId))
      .orderBy(desc(journalEntries.entryNumber))
      .limit(50),
    listAccounts(orgId),
  ]);
  const accountName = new Map(
    accounts.map((a) => [a.id, `${a.code} ${a.name}`]),
  );
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Belum ada entri jurnal.
      </p>
    );
  }
  // Baris satu query, dikelompokkan di memori (hindari N+1). Filter ke id
  // entri halaman — jangan muat seluruh ledger org (cubic pr8 jurnal:54).
  const entryIds = entries.map((e) => e.id);
  const lines = entryIds.length
    ? await db
        .select()
        .from(journalLines)
        .where(
          and(
            eq(journalLines.orgId, orgId),
            inArray(journalLines.entryId, entryIds),
          ),
        )
    : [];
  const byEntry = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = byEntry.get(l.entryId) ?? [];
    arr.push(l);
    byEntry.set(l.entryId, arr);
  }
  return (
    <div className="space-y-3">
      {entries.map((e) => {
        const entryLines = byEntry.get(e.id) ?? [];
        return (
          <Card key={e.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
              <div>
                <CardTitle className="text-sm font-medium">
                  #{String(e.entryNumber).padStart(3, "0")} · {e.date}
                </CardTitle>
                <CardDescription>
                  {e.description ?? "(tanpa keterangan)"}
                  {e.paymentMethod ? ` · ${e.paymentMethod}` : ""}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={e.status === "posted" ? "default" : "secondary"}
                >
                  {e.status}
                </Badge>
                {e.status === "draft" && <PostEntryButton entryId={e.id} />}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Akun</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entryLines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">
                        {accountName.get(l.accountId) ?? l.accountId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.debit ? formatIDR(l.debit) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.credit ? formatIDR(l.credit) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function EntriesSkeleton() {
  return <Skeleton className="h-72 w-full" />;
}

export default async function JurnalPage() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jurnal</h1>
          <p className="text-sm text-muted-foreground">
            Entri double-entry: draft dulu, posting untuk efek saldo.
          </p>
        </div>
        <div className="flex gap-2">
          <Suspense fallback={null}>
            <ClosePeriodGate orgId={orgId} userId={userId} />
          </Suspense>
          <Suspense fallback={null}>
            <NewEntryGate orgId={orgId} userId={userId} />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={<EntriesSkeleton />}>
        <Entries orgId={orgId} userId={userId} />
      </Suspense>
    </div>
  );
}

// Admin-only: member tidak boleh lihat tombol tutup periode (cubic pr8
// close-period:42 — closePeriod selalu gagal utk member).
async function ClosePeriodGate({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  const { role } = await requireOrgRole(userId, orgId, "member");
  if (!hasRole(role, "admin")) return null;
  return <ClosePeriodDialog />;
}

async function NewEntryGate({
  orgId,
  userId,
}: {
  orgId: string;
  userId: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const accounts = await listAccounts(orgId);
  return (
    <NewEntryDialog
      accounts={accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
      }))}
      defaultDate={jakartaDateISO(new Date())}
    />
  );
}
