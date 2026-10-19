"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  closeDealAction,
  setQuotationAction,
  createActivityAction,
} from "@/app/(app)/crm/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QUOT_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Terkirim",
  accepted: "Diterima",
  rejected: "Ditolak",
};

const NEXT_BY_STATUS: Record<string, { value: string; label: string }[]> = {
  draft: [{ value: "sent", label: "Kirim Quotation" }],
  sent: [
    { value: "accepted", label: "Quotation Diterima" },
    { value: "rejected", label: "Quotation Ditolak" },
  ],
  accepted: [],
  rejected: [],
};

export function DealActions({
  dealId,
  quotationStatus,
  status,
}: {
  dealId: string;
  quotationStatus: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const nexts = NEXT_BY_STATUS[quotationStatus] ?? [];

  function quotation(next: string) {
    startTransition(async () => {
      const result = await setQuotationAction(dealId, next);
      if (result.ok) toast.success(`Quotation: ${QUOT_LABEL[next]}`);
      else toast.error(result.error ?? "Gagal.");
    });
  }

  function close(outcome: "won" | "lost") {
    startTransition(async () => {
      const result = await closeDealAction(dealId, outcome);
      if (result.ok)
        toast.success(
          outcome === "won" ? "Deal dimenangkan!" : "Deal ditandai kalah.",
        );
      else toast.error(result.error ?? "Gagal.");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {nexts.map((n) => (
        <Button
          key={n.value}
          size="sm"
          variant={n.value === "rejected" ? "outline" : "default"}
          disabled={pending}
          onClick={() => quotation(n.value)}
        >
          {n.label}
        </Button>
      ))}
      {status === "open" && (
        <>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            disabled={pending}
            onClick={() => close("won")}
          >
            Close Won
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => close("lost")}
          >
            Close Lost
          </Button>
        </>
      )}
    </div>
  );
}

export { QUOT_LABEL };

export function ActivityForm({ dealId }: { dealId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await createActivityAction(formData);
          if (result.ok) toast.success("Aktivitas ditambahkan.");
          else toast.error(result.error ?? "Gagal.");
        });
      }}
    >
      <input type="hidden" name="dealId" value={dealId} />
      <div className="w-32">
        <Select name="type" defaultValue="note">
          <SelectTrigger aria-label="Jenis aktivitas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="call">Telepon</SelectItem>
            <SelectItem value="meeting">Meeting</SelectItem>
            <SelectItem value="task">Tugas</SelectItem>
            <SelectItem value="note">Catatan</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <input
        name="content"
        required
        placeholder="Tulis aktivitas..."
        className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Menyimpan..." : "Tambah"}
      </Button>
    </form>
  );
}
