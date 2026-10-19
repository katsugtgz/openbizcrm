"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { CrmDeal, CrmStage } from "@/lib/repos/crm-repo";
import { formatIDR } from "@/lib/money";
import { moveDealAction } from "./actions";
import { cn } from "cn";

const OUTCOME_RING: Record<string, string> = {
  won: "border-green-500 bg-green-50",
  lost: "border-red-500 bg-red-50",
  open: "border-border bg-card",
};

const COLUMN_HINT: Record<string, string> = {
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
};

interface BoardDeal extends CrmDeal {
  contactName?: string | null;
  companyName: string;
}

function DealCard({ deal }: { deal: BoardDeal }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });
  const ring = OUTCOME_RING[deal.status] ?? OUTCOME_RING.open;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab touch-none rounded-lg border p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing",
        ring,
        isDragging && "opacity-40",
      )}
      aria-roledescription="Kartu dapat diseret"
    >
      <Link
        href={`/crm/${deal.id}`}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-sm hover:underline"
      >
        {deal.title}
      </Link>
      <p className="mt-1 text-xs text-muted-foreground">{deal.companyName}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">
        {formatIDR(deal.value)}
      </p>
    </div>
  );
}

function Column({ stage, deals }: { stage: CrmStage; deals: BoardDeal[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const outcome =
    stage.name === "Close Won"
      ? "won"
      : stage.name === "Close Lost"
        ? "lost"
        : "open";
  return (
    <div
      className="flex min-w-[240px] flex-1 flex-col gap-2 rounded-lg bg-muted/50 p-2"
      style={{ contentVisibility: "auto" }}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold">{stage.name}</h3>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs tabular-nums",
            COLUMN_HINT[outcome] ?? "bg-secondary text-secondary-foreground",
          )}
        >
          {deals.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[120px] flex-1 flex-col gap-2 rounded-md p-1 transition-colors",
          isOver && "bg-accent/60 ring-2 ring-primary/40",
        )}
      >
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} />
        ))}
        {deals.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Kosong
          </p>
        )}
      </div>
    </div>
  );
}

export function DealBoard({
  stages,
  deals,
}: {
  stages: CrmStage[];
  deals: BoardDeal[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byStage = useMemo(() => {
    const map = new Map<string, BoardDeal[]>();
    for (const s of stages) map.set(s.id, []);
    for (const d of deals) {
      if (!map.has(d.stageId)) map.set(d.stageId, []);
      map.get(d.stageId)!.push(d);
    }
    return map;
  }, [stages, deals]);

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const dealId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    if (!stageId) return;
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === stageId) return;
    startTransition(async () => {
      const result = await moveDealAction(dealId, stageId);
      if (result.ok) {
        toast.success("Deal dipindahkan.");
      } else {
        toast.error(result.error ?? "Gagal memindahkan deal.");
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
        aria-label="Papan deal CRM"
      >
        {stages.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            deals={byStage.get(stage.id) ?? []}
          />
        ))}
      </div>
      <DragOverlay>
        {activeDeal ? (
          <div
            className={cn(
              "rounded-lg border p-3 shadow-lg",
              OUTCOME_RING[activeDeal.status] ?? OUTCOME_RING.open,
            )}
          >
            <p className="text-sm font-medium">{activeDeal.title}</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatIDR(activeDeal.value)}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
