"use client";

import { useMemo, useState } from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { computeLineTotals, floorTax } from "@/lib/invoicing/totals";
import { formatIDR } from "@/lib/money";
import { jakartaDateISO } from "@/lib/attendance/rules";
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
import { createInvoiceAction } from "./actions";

interface CompanyOption {
  id: string;
  name: string;
}

interface Item {
  description: string;
  qty: string;
  unitPrice: string;
}

const EMPTY: Item = { description: "", qty: "1", unitPrice: "" };

/** Live totals via totals.ts (pure) — angka identik dengan server. */
export function NewInvoiceDialog({
  companies,
}: {
  companies: CompanyOption[];
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [taxPct, setTaxPct] = useState("0");
  const [items, setItems] = useState<Item[]>([{ ...EMPTY }]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const totals = useMemo(() => {
    let subtotal = 0;
    let ok = items.length > 0;
    for (const it of items) {
      if (!it.description.trim() || !it.unitPrice) {
        ok = false;
        continue;
      }
      try {
        subtotal += computeLineTotals(
          Number(it.qty),
          Number(it.unitPrice),
          0,
        ).lineTotal;
      } catch {
        ok = false;
      }
    }
    try {
      const taxAmount = floorTax(subtotal, Number(taxPct || "0"));
      return { subtotal, taxAmount, total: subtotal + taxAmount, ok };
    } catch {
      return { subtotal, taxAmount: 0, total: subtotal, ok: false };
    }
  }, [items, taxPct]);

  function setItem(i: number, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    );
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!companyId) {
      toast.error("Pilih perusahaan terlebih dahulu.");
      return;
    }
    if (items.length === 0 || !totals.ok) {
      toast.error("Lengkapi minimal 1 item (deskripsi, qty, harga).");
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("companyId", companyId);
    formData.set("items", JSON.stringify(items));
    startTransition(async () => {
      const result = await createInvoiceAction(formData);
      if (result.ok) {
        setOpen(false);
        setItems([{ ...EMPTY }]);
        setCompanyId("");
        toast.success("Faktur draft dibuat.");
        if (result.redirectTo) router.push(result.redirectTo);
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  const today = jakartaDateISO(new Date());
  const in30 = jakartaDateISO(new Date(Date.now() + 30 * 86_400_000));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Faktur Baru</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Faktur Baru</DialogTitle>
            <DialogDescription>
              Tersimpan draft; kirim untuk posting jurnal piutang.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-company">Perusahaan</Label>
              <select
                id="inv-company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                aria-label="Perusahaan faktur"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Pilih perusahaan…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-tax">PPN (%)</Label>
              <Input
                id="inv-tax"
                name="taxPct"
                type="number"
                min={0}
                max={100}
                step={1}
                value={taxPct}
                onChange={(e) => setTaxPct(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-issue">Tanggal terbit</Label>
              <Input
                id="inv-issue"
                name="issueDate"
                type="date"
                required
                defaultValue={today}
                aria-label="Tanggal terbit (WIB)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-due">Jatuh tempo</Label>
              <Input
                id="inv-due"
                name="dueDate"
                type="date"
                required
                defaultValue={in30}
                aria-label="Jatuh tempo (WIB)"
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Item</p>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[2fr_70px_1fr] gap-2">
                <Input
                  value={it.description}
                  onChange={(e) => setItem(i, { description: e.target.value })}
                  placeholder={`Deskripsi item ${i + 1}`}
                  aria-label={`Deskripsi item ${i + 1}`}
                />
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={it.qty}
                  onChange={(e) => setItem(i, { qty: e.target.value })}
                  aria-label={`Qty item ${i + 1}`}
                  className="tabular-nums"
                />
                <Input
                  inputMode="numeric"
                  value={it.unitPrice}
                  onChange={(e) => setItem(i, { unitPrice: e.target.value })}
                  placeholder="Harga (Rp)"
                  aria-label={`Harga item ${i + 1}`}
                  className="tabular-nums"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((p) => [...p, { ...EMPTY }])}
            >
              + Item
            </Button>
            {items.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-2"
                onClick={() => setItems((p) => p.slice(0, -1))}
              >
                − Item terakhir
              </Button>
            )}
          </div>
          <div
            role="status"
            aria-live="polite"
            className="space-y-1 rounded-md border p-3 text-sm"
          >
            <p className="flex justify-between tabular-nums">
              <span>Subtotal</span>
              <span>{formatIDR(totals.subtotal)}</span>
            </p>
            <p className="flex justify-between tabular-nums">
              <span>PPN {taxPct || 0}%</span>
              <span>{formatIDR(totals.taxAmount)}</span>
            </p>
            <p className="flex justify-between border-t pt-1 font-semibold tabular-nums">
              <span>Total</span>
              <span>{formatIDR(totals.total)}</span>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-notes">Catatan</Label>
            <Input id="inv-notes" name="notes" placeholder="Opsional" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan..." : "Simpan Draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
