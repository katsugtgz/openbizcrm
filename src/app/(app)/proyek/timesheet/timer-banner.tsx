"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { stopTimerAction } from "@/app/(app)/proyek/actions";

/** Jam:menit:detik berjalan sejak startedAt; mulai null supaya SSR ==
 * hydration (cubic P2 timer-banner:10). */
function useElapsed(startedAtMs: number): string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // Tick pertama lewat interval 0 — setState tetap di callback, bukan di
    // body effect (react-hooks/set-state-in-effect).
    const initial = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, []);
  if (now === null) return null;
  const totalMin = Math.max(0, Math.floor((now - startedAtMs) / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor(((now - startedAtMs) % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TimerBanner({
  openTimer,
}: {
  openTimer: {
    startedAtMs: number;
    taskTitle: string;
    projectId: string;
  } | null;
}) {
  if (!openTimer) return null;
  return (
    <RunningTimer
      startedAtMs={openTimer.startedAtMs}
      taskTitle={openTimer.taskTitle}
    />
  );
}

function RunningTimer({
  startedAtMs,
  taskTitle,
}: {
  startedAtMs: number;
  taskTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const elapsed = useElapsed(startedAtMs);

  function stop() {
    startTransition(async () => {
      const result = await stopTimerAction();
      if (result.ok) {
        toast.success("Timer dihentikan.");
        router.refresh();
      } else {
        toast.error(result.error ?? "Gagal menghentikan timer.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-green-300 bg-green-50 px-4 py-3">
      <p className="text-sm font-medium text-green-900">
        Timer berjalan: {taskTitle} —{" "}
        <span className="tabular-nums font-mono">{elapsed}</span>
      </p>
      <Button variant="destructive" size="sm" onClick={stop} disabled={pending}>
        {pending ? "Menghentikan..." : "Stop Timer"}
      </Button>
    </div>
  );
}
