import { session } from "@/lib/auth";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users as schemaUsers } from "@/db/schema";
import {
  listLeaveRequests,
  listBalances,
  getEmployeeByUser,
} from "@/lib/leave/repo";
import { submitLeaveAction, actLeaveAction } from "./actions";
import { LeaveToasts } from "./toasts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Suspense } from "react";

const TYPE_LABEL: Record<string, string> = {
  cuti: "Cuti",
  izin: "Izin",
  sakit: "Sakit",
  wfh: "WFH",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

async function orgIdFor(userId: string): Promise<string> {
  const [row] = await db
    .select({ currentOrgId: schemaUsers.currentOrgId })
    .from(schemaUsers)
    .where(eq(schemaUsers.id, userId))
    .limit(1);
  if (!row?.currentOrgId) redirect("/dashboard");
  return row.currentOrgId;
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof session.getSession>>>;

type Balances = Awaited<ReturnType<typeof listBalances>>;

function BalanceCard({
  kind,
  balances,
  year,
}: {
  kind: "cuti" | "izin";
  balances: Balances;
  year: number;
}) {
  const bal = balances[0];
  const remaining = bal
    ? kind === "cuti"
      ? bal.cutiRemaining
      : bal.izinRemaining
    : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Sisa {TYPE_LABEL[kind]} {year}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">
          {remaining ?? "—"}
        </p>
      </CardContent>
    </Card>
  );
}

async function LeaveSection({
  user,
  orgId,
}: {
  user: SessionUser;
  orgId: string;
}) {
  const year = new Date().getFullYear();
  const requests = await listLeaveRequests(user.id, orgId);
  const employee = await getEmployeeByUser(user.id, orgId);
  const balances = employee ? await listBalances(user.id, orgId, year) : [];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BalanceCard kind="cuti" balances={balances} year={year} />
        <BalanceCard kind="izin" balances={balances} year={year} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ajukan Cuti / Izin</CardTitle>
          <CardDescription>
            Izin otomatis untuk tanggal sebelum 1 Juli; cuti sejak 1 Juli.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={submitLeaveAction} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="startDate">Tanggal mulai</Label>
                <Input id="startDate" name="startDate" type="date" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="endDate">Tanggal selesai</Label>
                <Input id="endDate" name="endDate" type="date" required />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="type">Jenis</Label>
              <select
                id="type"
                name="type"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                defaultValue=""
              >
                <option value="">Otomatis (dari tanggal)</option>
                <option value="cuti">Cuti</option>
                <option value="izin">Izin</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reason">Alasan</Label>
              <Textarea id="reason" name="reason" rows={2} />
            </div>
            <Button type="submit" className="w-fit">
              Ajukan
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Pengajuan</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Belum ada pengajuan cuti/izin.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Hari</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.requesterName ?? "—"}</TableCell>
                    <TableCell>{TYPE_LABEL[r.type] ?? r.type}</TableCell>
                    <TableCell>
                      {r.startDate} s/d {r.endDate}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Math.round(
                        (Date.parse(r.endDate) - Date.parse(r.startDate)) /
                          86_400_000,
                      ) + 1}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[r.status] ?? ""}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "pending" && r.currentApproverId ? (
                        <form
                          action={actLeaveAction}
                          className="inline-flex gap-2"
                        >
                          <input
                            type="hidden"
                            name="approvalId"
                            value={r.approvalId ?? ""}
                          />
                          <Button
                            type="submit"
                            name="decision"
                            value="approve"
                            size="sm"
                            variant="outline"
                          >
                            Setujui
                          </Button>
                          <Button
                            type="submit"
                            name="decision"
                            value="reject"
                            size="sm"
                            variant="destructive"
                          >
                            Tolak
                          </Button>
                        </form>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function SectionSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-9 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
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
    </>
  );
}

export default async function CutiPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const orgId = await orgIdFor(user.id);
  const sp = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Cuti &amp; Izin
        </h1>
        <p className="text-sm text-muted-foreground">
          Ajukan cuti/izin dan pantau status persetujuan.
        </p>
      </div>
      <Suspense fallback={<SectionSkeleton />}>
        <LeaveSection user={user} orgId={orgId} />
      </Suspense>
      {/* hasil server action via searchParams -> toast klien */}
      <LeaveToasts ok={sp.ok} error={sp.error} />
    </div>
  );
}
