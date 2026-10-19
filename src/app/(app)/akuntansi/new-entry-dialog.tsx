"use client";

import { useMemo, useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { validateEntry } from "@/lib/accounting/engine";
import { formatIDR } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createJournalEntryAction } from "./actions";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

const EMPTY: Line = { accountId: "", debit: "", credit: "" };

/** Live totals via validateEntry (pure engine) — belum menyentuh DB. */
export function NewEntryDialog({
  accounts,
  defaultDate,
}: {
  accounts: AccountOption[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([EMPTY, EMPTY]);
  const [pending, startTransition] = useTransition();

  const numeric = useMemo(
    () =>
      lines.map((l) => ({
        accountCode: accounts.find((a) => a.id === l.accountId)?.code ?? "?",
        debit: l.debit ? Number(l.debit) : 0,
        credit: l.credit ? Number(l.credit) : 0,
      })),
    [lines, accounts],
  );
  const errors = useMemo(() => validateEntry(numeric), [numeric]);
  const totalDebit = numeric.reduce((s, l) => s + l.debit, 0);
  const totalCredit = numeric.reduce((s, l) => s + l.credit, 0);
  const balanced = errors.length === 0;

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("lines", JSON.stringify(lines));
    startTransition(async () => {
      const result = await createJournalEntryAction(formData);
      if (result.ok) {
        setOpen(false);
        setLines([EMPTY, EMPTY]);
        toast.success("Entri jurnal draft dibuat. Posting untuk efek saldo.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Entri Baru</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Entri Jurnal Baru</DialogTitle>
            <DialogDescription>
              Debit harus sama dengan credit; tersimpan sebagai draft.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="entry-date">Tanggal</Label>
              <Input
                id="entry-date"
                name="date"
                type="date"
                required
                defaultValue={defaultDate}
                aria-label="Tanggal entri (WIB)"
              />
            </div>
            <div className="flex-[2] space-y-2">
              <Label htmlFor="entry-desc">Keterangan</Label>
              <Input
                id="entry-desc"
                name="description"
                placeholder="Pembelian perlengkapan"
              />
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_1fr] gap-2">
                <select
                  value={line.accountId}
                  onChange={(e) => setLine(i, { accountId: e.target.value })}
                  aria-label={`Akun baris ${i + 1}`}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Pilih akun…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
                <Input
                  inputMode="numeric"
                  value={line.debit}
                  onChange={(e) =>
                    setLine(i, { debit: e.target.value, credit: "" })
                  }
                  placeholder="Debit"
                  aria-label={`Debit baris ${i + 1}`}
                  className="tabular-nums"
                />
                <Input
                  inputMode="numeric"
                  value={line.credit}
                  onChange={(e) =>
                    setLine(i, { credit: e.target.value, debit: "" })
                  }
                  placeholder="Credit"
                  aria-label={`Credit baris ${i + 1}`}
                  className="tabular-nums"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((p) => [...p, { ...EMPTY }])}
            >
              + Baris
            </Button>
          </div>
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border p-3 text-sm"
          >
            <p className="flex justify-between tabular-nums">
              <span>Total debit</span>
              <span>{formatIDR(totalDebit)}</span>
            </p>
            <p className="flex justify-between tabular-nums">
              <span>Total credit</span>
              <span>{formatIDR(totalCredit)}</span>
            </p>
            <p
              className={
                balanced
                  ? "mt-1 text-xs text-muted-foreground"
                  : "mt-1 text-xs text-destructive"
              }
            >
              {lines.length < 2
                ? "Minimal 2 baris."
                : balanced
                  ? "Seimbang — siap disimpan."
                  : errors[0]}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={pending || !balanced}>
              {pending ? "Menyimpan..." : "Simpan Draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
