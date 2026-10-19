import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tasks, timesheets } from "@/db/schema";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { jakartaDateISO } from "@/lib/attendance/rules";
import { listMine } from "@/lib/timesheet/service";
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
import { TimerBanner } from "./timer-banner";

export const metadata = { title: "Timesheet Saya" };

const DAY_MS = 86_400_000;
const DAY_LABEL = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

async function TimesheetView({
  userId,
  orgId,
  weekStart,
}: {
  userId: string;
  orgId: string;
  weekStart: string;
}) {
  await requireOrgRole(userId, orgId, "member");
  const from = weekStart;
  const to = new Date(new Date(`${from}T00:00:00Z`).getTime() + 6 * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const [rows, openTimerRows] = await Promise.all([
    // listMine memfilter tanggal WIB, bukan UTC.
    listMine(userId, orgId, { from, to }),
    db
      .select({
        startedAt: timesheets.startedAt,
        taskTitle: tasks.title,
        projectId: tasks.projectId,
      })
      .from(timesheets)
      .innerJoin(tasks, eq(timesheets.taskId, tasks.id))
      .where(
        and(
          eq(timesheets.orgId, orgId),
          eq(timesheets.userId, userId),
          isNull(timesheets.endedAt),
        ),
      )
      .limit(1),
  ]);

  // Rekap per hari (Senin-Minggu).
  const perDay = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    perDay.set(
      new Date(new Date(`${from}T00:00:00Z`).getTime() + i * DAY_MS)
        .toISOString()
        .slice(0, 10),
      0,
    );
  }
  for (const r of rows) {
    if (r.minutes) {
      const day = jakartaDateISO(r.startedAt);
      perDay.set(day, (perDay.get(day) ?? 0) + r.minutes);
    }
  }
  const total = rows.reduce((sum, r) => sum + (r.minutes ?? 0), 0);
  const open = openTimerRows[0] ?? null;

  return (
    <div className="space-y-6">
      <TimerBanner
        openTimer={
          open
            ? {
                startedAtMs: open.startedAt.getTime(),
                taskTitle: open.taskTitle,
                projectId: open.projectId,
              }
            : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Rekap Minggu {from} s/d {to}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {Array.from(perDay.entries()).map(([day, min], i) => (
              <div
                key={day}
                className={`rounded-lg border p-2 text-center ${min > 0 ? "bg-accent" : ""}`}
              >
                <p className="text-xs text-muted-foreground">{DAY_LABEL[i]}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">
                  {fmtMinutes(min)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm font-medium">
            Total minggu ini:{" "}
            <span className="tabular-nums">{fmtMinutes(total)}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Timer</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Belum ada timer minggu ini. Mulai dari kartu task di kanban
              proyek.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mulai</TableHead>
                  <TableHead>Selesai</TableHead>
                  <TableHead className="text-right">Durasi</TableHead>
                  <TableHead>Catatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      {r.startedAt.toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.endedAt
                        ? r.endedAt.toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.minutes !== null ? fmtMinutes(r.minutes) : "berjalan"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.notes ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ViewSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-48" />
      </CardHeader>
      <CardContent className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs, resolved once for the whole page.
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  const { userId, orgId } = ids;

  const sp = await searchParams;
  // WIB kalender, bukan UTC.
  const today = jakartaDateISO(new Date());
  // Regex meloloskan "2024-13-01"; Date.parse menerima overflow
  // ("2024-02-31" jadi 2 Maret) — normalisasi harus persis sama dengan input,
  // kalau tidak fallback ke hari ini.
  const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : null;
  const weekStart = mondayOf(
    weekParam &&
      new Date(`${weekParam}T00:00:00Z`).toISOString().slice(0, 10) ===
        weekParam
      ? weekParam
      : today,
  );
  const prevWeek = new Date(
    new Date(`${weekStart}T00:00:00Z`).getTime() - 7 * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  const nextWeek = new Date(
    new Date(`${weekStart}T00:00:00Z`).getTime() + 7 * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Timesheet Saya
          </h1>
          <p className="text-sm text-muted-foreground">
            Timer pribadi dan rekap per minggu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/proyek/timesheet?week=${prevWeek}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            aria-label="Minggu sebelumnya"
          >
            ← Sebelumnya
          </Link>
          <Link
            href={`/proyek/timesheet?week=${nextWeek}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            aria-label="Minggu berikutnya"
          >
            Berikutnya →
          </Link>
        </div>
      </div>
      <Suspense fallback={<ViewSkeleton />}>
        <TimesheetView userId={userId} orgId={orgId} weekStart={weekStart} />
      </Suspense>
    </div>
  );
}
