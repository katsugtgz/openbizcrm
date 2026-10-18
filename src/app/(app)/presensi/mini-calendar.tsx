import Link from "next/link";
import { monthDays, shiftMonth } from "@/lib/calendar";
import { listAttendances } from "@/lib/repos/hrm-repo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Titik status: hijau ontime/wfh, kuning late, merah absent. */
const DOT: Record<string, string> = {
  ontime: "bg-green-500",
  wfh: "bg-green-400",
  late: "bg-yellow-500",
  absent: "bg-red-500",
  leave: "bg-blue-400",
};

/**
 * Mini-calendar bulan berjalan + titik status presensi. Navigasi bulan
 * via query `?m=YYYY-MM`.
 */
export async function MiniCalendar({
  orgId,
  employeeId,
  month, // "YYYY-MM"
}: {
  orgId: string;
  employeeId: string | null;
  month: string;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const attendances = employeeId
    ? await listAttendances(orgId, {
        from: first,
        to: `${month}-${String(lastDay).padStart(2, "0")}`,
        employeeId,
      })
    : [];
  const byDate = new Map(attendances.map((a) => [a.date, a]));

  const days = monthDays(y, m);
  const todayISO = new Date().toISOString().slice(0, 10);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {new Date(`${first}T00:00:00Z`).toLocaleDateString("id-ID", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </CardTitle>
        <div className="flex gap-1">
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-7"
            aria-label="Bulan sebelumnya"
          >
            <Link href={`/presensi?m=${prev}`} aria-label="Bulan sebelumnya">
              ‹
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="icon"
            className="size-7"
            aria-label="Bulan berikutnya"
          >
            <Link href={`/presensi?m=${next}`} aria-label="Bulan berikutnya">
              ›
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {DAY_LABELS.map((d) => (
            <div key={d} className="py-1 font-medium text-muted-foreground">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const att = byDate.get(day.date);
            return (
              <div
                key={day.date}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center rounded-md text-sm",
                  !day.inMonth && "text-muted-foreground/40",
                  day.weekend && day.inMonth && "bg-muted/50",
                  day.date === todayISO && "ring-1 ring-primary",
                )}
                title={att ? `${day.date}: ${att.status}` : undefined}
              >
                <span className="tabular-nums">
                  {Number(day.date.slice(8))}
                </span>
                {att && (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      DOT[att.status] ?? "bg-muted-foreground",
                    )}
                    aria-label={att.status}
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
