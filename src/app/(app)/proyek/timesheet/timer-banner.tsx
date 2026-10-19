"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { stopTimerAction } from "@/app/(app)/proyek/actions";

/** Jam:menit berjalan sejak startedAt; update tiap detik. */
function useElapsed(startedAtMs: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
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
  const [pending, startTransition] = useTransition();
  const elapsed = useElapsed(startedAtMs);

  function stop() {
    startTransition(async () => {
      const result = await stopTimerAction();
      if (result.ok) toast.success("Timer dihentikan.");
      else toast.error(result.error ?? "Gagal menghentikan timer.");
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
