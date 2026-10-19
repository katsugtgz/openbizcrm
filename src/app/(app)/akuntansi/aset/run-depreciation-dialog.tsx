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
import { runDepreciationAction } from "../actions";

function currentPeriod(): string {
  // "YYYY-MM" WIB: shift +7 jam sebelum ambil ISO.
  const shifted = new Date(Date.now() + 7 * 60 * 60_000);
  return shifted.toISOString().slice(0, 7);
}

export function RunDepreciationDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await runDepreciationAction(formData);
      if (result.ok) {
        setOpen(false);
        toast.success(`Depresiasi selesai: ${result.message}`);
      } else {
        toast.error(result.error ?? "Gagal.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Jalankan Penyusutan
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Jalankan Penyusutan Bulanan</DialogTitle>
            <DialogDescription>
              Idempoten per bulan: aset yang sudah mencapai periode ini
              dilewati. Jurnal posted otomatis per aset.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="dep-period">Sampai periode (YYYY-MM)</Label>
            <Input
              id="dep-period"
              name="periodEnd"
              required
              pattern="\d{4}-\d{2}"
              defaultValue={currentPeriod()}
              className="font-mono"
            />
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
              {pending ? "Memproses…" : "Jalankan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
