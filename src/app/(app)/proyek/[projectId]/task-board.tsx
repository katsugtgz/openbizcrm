"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Task } from "@/db/schema";
import {
  reorderTaskAction,
  startTimerAction,
  deleteTaskAction,
} from "@/app/(app)/proyek/actions";
import { cn } from "cn";

const COLUMNS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "Dikerjakan" },
  { value: "review", label: "Review" },
  { value: "done", label: "Selesai" },
  { value: "blocked", label: "Terblokir" },
] as const;

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-800",
  high: "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-800",
};

interface TaskView extends Task {
  assigneeName?: string | null;
}

function TaskCard({
  task,
  columnStatus,
}: {
  task: TaskView;
  columnStatus: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
  });
  // Kartu juga drop target: drop id "<status>:<taskId>" memberi index
  // presisi (sebelum kartu ini), drop area kolom = akhir kolom (cubic P2
  // task-board:214).
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `${columnStatus}:${task.id}`,
  });
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab touch-none rounded-lg border bg-card p-2.5 shadow-sm hover:shadow-md active:cursor-grabbing",
        isDragging && "opacity-40",
        isOver && "ring-2 ring-primary/40",
      )}
      aria-roledescription="Kartu dapat diseret"
    >
      <p className="text-sm font-medium">{task.title}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium",
            PRIORITY_BADGE[task.priority] ?? "",
          )}
        >
          {task.priority}
        </span>
        {task.dueDate && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {task.dueDate}
          </span>
        )}
        {task.assigneeName && (
          <span className="text-[10px] text-muted-foreground">
            {task.assigneeName}
          </span>
        )}
      </div>
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
  projectId,
}: {
  status: string;
  label: string;
  tasks: TaskView[];
  projectId: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [pending, startTransition] = useTransition();

  function startTimer(taskId: string) {
    startTransition(async () => {
      const result = await startTimerAction(taskId, projectId);
      if (result.ok) toast.success("Timer dimulai.");
      else toast.error(result.error ?? "Gagal memulai timer.");
    });
  }

  function removeTask(taskId: string) {
    startTransition(async () => {
      const result = await deleteTaskAction(taskId, projectId);
      if (result.ok) toast.success("Task dihapus.");
      else toast.error(result.error ?? "Gagal.");
    });
  }

  return (
    <div
      className="flex min-w-[220px] flex-1 flex-col gap-2 rounded-lg bg-muted/50 p-2"
      style={{ contentVisibility: "auto" }}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs tabular-nums text-secondary-foreground">
          {tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[100px] flex-1 flex-col gap-2 rounded-md p-1 transition-colors",
          isOver && "bg-accent/60 ring-2 ring-primary/40",
        )}
      >
        {tasks.map((task) => (
          <div key={task.id} className="group/card relative">
            <TaskCard task={task} columnStatus={status} />
            {/* Tetap di layout, muncul saat hover ATAU fokus keyboard —
                hidden membuat tombol tak bisa di-tab (cubic P2
                task-board:134). */}
            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startTimer(task.id);
                }}
                disabled={pending}
                className="rounded bg-card px-1.5 py-0.5 text-[10px] shadow ring-1 ring-border hover:bg-accent"
                aria-label={`Mulai timer untuk ${task.title}`}
              >
                ▶ Timer
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTask(task.id);
                }}
                disabled={pending}
                className="rounded bg-card px-1.5 py-0.5 text-[10px] text-red-600 shadow ring-1 ring-border hover:bg-accent"
                aria-label={`Hapus ${task.title}`}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="py-5 text-center text-xs text-muted-foreground">
            Kosong
          </p>
        )}
      </div>
    </div>
  );
}

export function TaskBoard({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: TaskView[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Keyboard: user keyboard bisa memindah task (Space untuk angkat,
    // arrow untuk geser, Space untuk drop) — cubic P2 task-board:182.
    // Ponytail: coordinateGetter default (tanpa snap per kartu).
    useSensor(KeyboardSensor, {}),
  );

  const byStatus = useMemo(() => {
    const map = new Map<string, TaskView[]>();
    for (const c of COLUMNS) map.set(c.value, []);
    for (const t of tasks) {
      if (!map.has(t.status)) map.set(t.status, []);
      map.get(t.status)!.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [tasks]);

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const taskId = String(e.active.id);
    // Over id: "<status>:<taskId>" (kartu) atau "<status>" (area kolom).
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const [toStatus, overTaskId] = overId.includes(":")
      ? overId.split(":")
      : [overId, null];
    if (!toStatus) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const column = byStatus.get(toStatus) ?? [];
    // Index target: drop di kartu = sebelum kartu itu (cubic P2
    // task-board:214), drop di area kosong kolom = akhir kolom. Drop pada
    // diri sendiri = tidak berubah.
    const overIndex = overTaskId
      ? column.findIndex((t) => t.id === overTaskId)
      : column.length;
    if (overIndex < 0) return;
    const currentIndex = column.findIndex((t) => t.id === taskId);
    // Dalam satu kolom dan posisi tidak berubah (sebelum kartu lain
    // berarti tetap di tempat ketika kartu di atasnya) — tanpa server.
    if (
      task.status === toStatus &&
      (currentIndex === overIndex || currentIndex + 1 === overIndex)
    ) {
      return;
    }
    startTransition(async () => {
      const result = await reorderTaskAction(
        projectId,
        taskId,
        toStatus,
        currentIndex < overIndex ? overIndex - 1 : overIndex,
      );
      if (result.ok) {
        toast.success("Task dipindahkan.");
      } else {
        toast.error(result.error ?? "Gagal memindahkan task.");
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div
        className="flex gap-3 overflow-x-auto pb-2"
        aria-busy={pending}
        aria-label="Papan task"
      >
        {COLUMNS.map((c) => (
          <Column
            key={c.value}
            status={c.value}
            label={c.label}
            tasks={byStatus.get(c.value) ?? []}
            projectId={projectId}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="rounded-lg border bg-card p-2.5 shadow-lg">
            <p className="text-sm font-medium">{activeTask.title}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export { COLUMNS };
