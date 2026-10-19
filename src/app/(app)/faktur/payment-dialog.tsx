"use client";

import { useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
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
import { recordPaymentAction } from "./actions";

export function PaymentDialog({
  invoiceId,
  remaining,
}: {
  invoiceId: string;
  remaining: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(remaining));
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("invoiceId", invoiceId);
    startTransition(async () => {
      const result = await recordPaymentAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success("Pembayaran dicatat.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Catat Pembayaran</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Catat Pembayaran</DialogTitle>
            <DialogDescription>
              Sisa tagihan {formatIDR(remaining)}. Overpayment ditolak. Jurnal
              kas/AR posted otomatis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pay-amount">Jumlah (Rp)</Label>
            <Input
              id="pay-amount"
              name="amount"
              inputMode="numeric"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pay-method">Metode</Label>
              <select
                id="pay-method"
                name="method"
                defaultValue="transfer"
                aria-label="Metode pembayaran"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="transfer">Transfer</option>
                <option value="cash">Kas</option>
                <option value="qris">QRIS</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-date">Tanggal bayar</Label>
              <Input
                id="pay-date"
                name="paidAt"
                type="date"
                required
                defaultValue={jakartaDateISO(new Date())}
                aria-label="Tanggal bayar (WIB)"
              />
            </div>
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
              {pending ? "Memproses…" : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
