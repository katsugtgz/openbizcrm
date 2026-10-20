"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  closeDealAction,
  deleteDealAction,
  setQuotationAction,
  createActivityAction,
  updateDealAction,
} from "@/app/(app)/crm/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QUOT_LABEL } from "@/lib/deals/labels";

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

export function EditDealForm({
  deal,
  contacts,
}: {
  deal: { id: string; title: string; value: number; contactId: string | null };
  contacts: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(formData) => {
        startTransition(async () => {
          const result = await updateDealAction(formData);
          if (result.ok) toast.success("Deal diperbarui.");
          else toast.error(result.error ?? "Gagal.");
        });
      }}
    >
      <input type="hidden" name="id" value={deal.id} />
      <div className="min-w-40 flex-1">
        <label
          htmlFor="edit-deal-title"
          className="text-xs text-muted-foreground"
        >
          Judul
        </label>
        <input
          id="edit-deal-title"
          name="title"
          required
          defaultValue={deal.title}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <div className="w-36">
        <label
          htmlFor="edit-deal-value"
          className="text-xs text-muted-foreground"
        >
          Nilai (Rp)
        </label>
        <input
          id="edit-deal-value"
          name="value"
          inputMode="numeric"
          defaultValue={String(deal.value)}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <div className="w-44">
        <label htmlFor="edit-deal-contact" className="text-xs text-muted-foreground">
          Kontak
        </label>
        <Select name="contactId" defaultValue={deal.contactId ?? ""}>
          <SelectTrigger id="edit-deal-contact">
            <SelectValue placeholder="Tanpa kontak" />
          </SelectTrigger>
          <SelectContent>
            {contacts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Menyimpan..." : "Simpan"}
      </Button>
    </form>
  );
}

export function DeleteDealButton({ dealId }: { dealId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        Hapus deal
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Yakin hapus?</span>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await deleteDealAction(dealId);
            if (result.ok) {
              toast.success("Deal dihapus.");
              if (result.redirectTo) router.push(result.redirectTo);
            } else {
              toast.error(result.error ?? "Gagal.");
              setConfirming(false);
            }
          });
        }}
      >
        {pending ? "Menghapus..." : "Ya, hapus"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        Batal
      </Button>
    </span>
  );
}

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
