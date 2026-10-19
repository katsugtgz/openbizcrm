"use client";

import { useMemo } from "react";

interface GanttTask {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  createdAt: string;
}

const DAY_MS = 86_400_000;

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function parseDay(s: string): number {
  return new Date(`${s}T00:00:00Z`).getTime();
}

const STATUS_BG: Record<string, string> = {
  todo: "bg-gray-400",
  in_progress: "bg-blue-500",
  review: "bg-orange-400",
  done: "bg-green-500",
  blocked: "bg-red-500",
};

/**
 * Gantt ringan: grid CSS murni. Baris = task, kolom = minggu (Senin).
 * Lebar bar mengikuti rentang createdAt -> dueDate.
 */
export function GanttChart({ tasks }: { tasks: GanttTask[] }) {
  const { weeks, bars } = useMemo(() => {
    const dated = tasks.filter(
      (t): t is GanttTask & { dueDate: string } => t.dueDate !== null,
    );
    if (dated.length === 0) return { weeks: [], bars: [] as never[] };

    const starts = dated.map((t) => parseDay(dateOnly(t.createdAt)));
    const ends = dated.map((t) => parseDay(t.dueDate));
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    // Snap ke Senin. `last` TANPA roll-forward: due tepat di Senin terakhir
    // tetap punya minggunya sendiri, tidak nol lebar (cubic P2 gantt:54).
    const first = new Date(min);
    first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
    const last = new Date(max);
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() + 6) % 7));
    const weekStarts: number[] = [];
    for (let d = first.getTime(); d <= last.getTime(); d += 7 * DAY_MS) {
      weekStarts.push(d);
    }

    const totalWeeks = weekStarts.length;
    const barsOut = dated.map((t) => {
      const s = parseDay(dateOnly(t.createdAt));
      const e = parseDay(t.dueDate);
      const colStart = weekStarts.filter((w) => w <= s).length;
      // `<=` + 1: kolom = jumlah minggu yang tersentuh (inklusif minggu due);
      // tanpa +1 bar due di minggu start-nya sendiri jadi nol lebar
      // (cubic P2 gantt:63).
      const colEnd = weekStarts.filter((w) => w <= e).length + 1;
      const start = Math.min(Math.max(colStart, 1), totalWeeks);
      const end = Math.min(Math.max(colEnd, start), totalWeeks + 1);
      return { task: t, start, span: end - start };
    });
    return { weeks: weekStarts, bars: barsOut };
  }, [tasks]);

  if (weeks.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Tambahkan due date pada task untuk melihat gantt.
      </p>
    );
  }

  const fmt = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-max"
        role="group"
        aria-label={`Gantt ${tasks.length} task dalam ${weeks.length} minggu`}
      >
        {/* Header minggu */}
        <div
          className="grid border-b"
          style={{
            gridTemplateColumns: `200px repeat(${weeks.length}, minmax(64px, 1fr))`,
          }}
        >
          <div className="p-2 text-xs font-medium text-muted-foreground">
            Task
          </div>
          {weeks.map((w) => (
            <div
              key={w}
              className="border-l p-2 text-center text-[10px] text-muted-foreground"
            >
              {fmt.format(new Date(w))}
            </div>
          ))}
        </div>
        {/* Baris task */}
        {bars.map(({ task, start, span }) => (
          <div
            key={task.id}
            className="grid items-center border-b border-dashed"
            style={{
              gridTemplateColumns: `200px repeat(${weeks.length}, minmax(64px, 1fr))`,
            }}
          >
            <div className="truncate p-2 text-xs" title={task.title}>
              {task.title}
            </div>
            {weeks.map((w, i) => (
              <div key={w} className="relative h-8 border-l">
                {i + 1 === start && (
                  <div
                    className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${STATUS_BG[task.status] ?? "bg-gray-400"}`}
                    style={{
                      left: 4,
                      width: `calc(${span} * 100% + ${(span - 1) * 1}px - 8px)`,
                    }}
                    title={`${task.title}: ${dateOnly(task.createdAt)} → ${task.dueDate}`}
                  />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
