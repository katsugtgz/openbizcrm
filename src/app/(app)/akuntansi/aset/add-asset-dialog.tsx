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
import { addAssetAction } from "../actions";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

function AccountSelect({
  id,
  label,
  accounts,
  value,
  onChange,
}: {
  id: string;
  label: string;
  accounts: AccountOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={id}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
      >
        <option value="">Pilih akun…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} — {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AddAssetDialog({
  expenseAccounts,
  assetAccounts,
  isAdmin,
}: {
  expenseAccounts: AccountOption[];
  assetAccounts: AccountOption[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [expenseAcc, setExpenseAcc] = useState("");
  const [accumAcc, setAccumAcc] = useState("");

  // Tutup tanpa simpan tidak boleh membawa pilihan akun aset sebelumnya.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setExpenseAcc("");
      setAccumAcc("");
    }
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!expenseAcc || !accumAcc) {
      toast.error("Pilih kedua akun penyusutan.");
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("depreciationExpenseAccountId", expenseAcc);
    formData.set("accumulatedDepreciationAccountId", accumAcc);
    startTransition(async () => {
      const result = await addAssetAction(formData);
      if (result.ok) {
        handleOpenChange(false);
        toast.success("Aset ditambahkan.");
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  if (!isAdmin) return null; // admin-only: sembunyikan trigger utk member

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">Aset Baru</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Aset Tetap Baru</DialogTitle>
            <DialogDescription>
              Admin saja. Penyusutan dihitung garis lurus per bulan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="asset-name">Nama</Label>
            <Input
              id="asset-name"
              name="name"
              required
              placeholder="Laptop ThinkPad"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="asset-cost">Harga perolehan (Rp)</Label>
              <Input
                id="asset-cost"
                name="cost"
                inputMode="numeric"
                required
                placeholder="15000000"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-salvage">Nilai sisa (Rp)</Label>
              <Input
                id="asset-salvage"
                name="salvageValue"
                inputMode="numeric"
                placeholder="0"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-life">Umur (bulan)</Label>
              <Input
                id="asset-life"
                name="usefulLifeMonths"
                type="number"
                min={1}
                step={1}
                required
                defaultValue={48}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asset-acquired">Tanggal perolehan</Label>
              <Input
                id="asset-acquired"
                name="acquiredDate"
                type="date"
                required
                defaultValue={jakartaDateISO(new Date())}
                aria-label="Tanggal perolehan (WIB)"
              />
            </div>
          </div>
          <AccountSelect
            id="expenseAcc"
            label="Akun beban penyusutan"
            accounts={expenseAccounts}
            value={expenseAcc}
            onChange={setExpenseAcc}
          />
          <AccountSelect
            id="accumAcc"
            label="Akun akumulasi penyusutan"
            accounts={assetAccounts}
            value={accumAcc}
            onChange={setAccumAcc}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
