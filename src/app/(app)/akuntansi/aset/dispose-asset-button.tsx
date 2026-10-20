"use client";

import { useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
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
import { jakartaDateISO } from "@/lib/attendance/rules";
import { disposeAssetAction } from "../actions";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

export function DisposeAssetButton({
  assetId,
  assetAccounts,
  expenseAccounts,
}: {
  assetId: string;
  assetAccounts: AccountOption[];
  expenseAccounts: AccountOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [assetAcc, setAssetAcc] = useState("");
  const [lossAcc, setLossAcc] = useState("");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setAssetAcc("");
      setLossAcc("");
    }
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!assetAcc || !lossAcc) {
      toast.error("Pilih akun aset dan akun rugi disposal.");
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("assetId", assetId);
    formData.set("assetAccountId", assetAcc);
    formData.set("lossAccountId", lossAcc);
    startTransition(async () => {
      const result = await disposeAssetAction(formData);
      if (result.ok) {
        handleOpenChange(false);
        toast.success("Aset di-dispose + jurnal derecognition diposting.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Dispose
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Dispose Aset</DialogTitle>
            <DialogDescription>
              Menandai aset non-aktif + posting jurnal derecognition (akumulasi
              & rugi NBV vs cost).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dispose-date">Tanggal disposal</Label>
            <Input
              id="dispose-date"
              name="disposalDate"
              type="date"
              required
              defaultValue={jakartaDateISO(new Date())}
              aria-label="Tanggal disposal (WIB)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dispose-asset-acc">Akun aset tetap</Label>
            <select
              id="dispose-asset-acc"
              required
              value={assetAcc}
              onChange={(e) => setAssetAcc(e.target.value)}
              aria-label="Akun aset tetap"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Pilih akun…</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dispose-loss-acc">Akun rugi disposal</Label>
            <select
              id="dispose-loss-acc"
              required
              value={lossAcc}
              onChange={(e) => setLossAcc(e.target.value)}
              aria-label="Akun rugi disposal"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Pilih akun…</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Memproses…" : "Dispose"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
